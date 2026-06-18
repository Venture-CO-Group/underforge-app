import Anthropic from '@anthropic-ai/sdk';
import * as FileSystem from 'expo-file-system/legacy';
import OpenAI from 'openai';
import { glowLogger } from './glow-logger';
import { buildLanguageInstruction } from './llm-service';

// Initialize OpenAI client (primary)
const openai = new OpenAI({
  apiKey: process.env.EXPO_PUBLIC_OPENAI_API_KEY || '',
});

// Initialize Anthropic client (fallback)
const anthropic = new Anthropic({
  apiKey: process.env.EXPO_PUBLIC_ANTHROPIC_API_KEY || '',
});

// Shared self-check the model must perform IN-CONTEXT before committing macros.
// This replaces the old deterministic post-processing (keyword/oil-floor rules)
// that misclassified items by name substring (e.g. "boiled" matched "oil" and
// clamped boiled potatoes to ~95% fat). The model reasons about the real cooking
// method per component, which catches both over- and under-estimates of fat.
const FAT_REASONING_INSTRUCTION = `FAT SELF-CHECK (do this in the "fatReasoning" field BEFORE writing any numbers):
- State the cooking method for each component.
- Account for fat component-by-component: each food's intrinsic fat PLUS only the oil its ACTUAL cooking method adds.
- Boiled, steamed, poached, raw, and plain-grilled items absorb little to NO added oil. Only fried, deep-fried, stir-fried, sautéed, pan-fried, curried, roasted, or dressed items carry meaningful added fat.
- Hard sanity bounds: a single component's fat can NEVER exceed its own weight in grams, and the total "fat" must equal the sum of the component fats. A 180g potato cannot contain 170g of fat.
- This is where you catch mistakes in BOTH directions — under-counting oil on a fried dish, and absurd over-counts like a boiled vegetable reading as pure fat.`;

// Retry configuration
const GPT5_MAX_RETRIES = 2; // Try GPT-4o twice before falling back to Anthropic
const INITIAL_RETRY_DELAY_MS = 1000;
const MAX_RETRY_DELAY_MS = 10000;

// Helper function to check if error is retryable
function isRetryableError(error: any): boolean {
  if (error instanceof Error) {
    const errorMessage = error.message.toLowerCase();
    if (errorMessage.includes('529') || errorMessage.includes('overloaded') ||
        errorMessage.includes('rate limit') || errorMessage.includes('timeout')) {
      return true;
    }
  }

  if (error?.status && typeof error.status === 'number') {
    const status = error.status;
    if (status >= 500 || status === 429 || status === 529) {
      return true;
    }
  }

  return false;
}

// Helper function to calculate retry delay with exponential backoff
function calculateRetryDelay(attempt: number): number {
  const baseDelay = INITIAL_RETRY_DELAY_MS * Math.pow(2, attempt - 1);
  const jitter = Math.random() * 0.3 * baseDelay;
  const delay = Math.min(baseDelay + jitter, MAX_RETRY_DELAY_MS);
  return Math.floor(delay);
}

// Helper function to sleep
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Helper function to parse JSON from LLM response (handles markdown code blocks)
function parseJsonFromLLMResponse<T>(content: string): T {
  // Strategy 1: Try direct JSON.parse (works when response_format is used)
  try {
    return JSON.parse(content);
  } catch {
    // Not valid JSON directly, try extraction
  }

  // Strategy 2: Remove markdown code blocks if present
  const cleaned = content
    .replace(/```json\n?/g, '')
    .replace(/```\n?/g, '')
    .trim();
  
  try {
    return JSON.parse(cleaned);
  } catch {
    // Still not valid, throw with helpful error
    throw new Error(`Could not parse JSON from response: ${content.substring(0, 100)}...`);
  }
}

export interface FoodItemMacro {
  name: string;
  grams: number;
  carbs: number;
  protein: number;
  fat: number;
  fiber: number;
  // No per-item calories: the total is derived from summed macros
  // (4·carbs + 4·protein + 9·fat). Storage re-derives them when needed.
}

// Raw macro analysis from LLM (before calorie calculation)
interface RawMacroAnalysis {
  description: string;
  shortDescription: string;
  foodQuantities: string;
  fatReasoning?: string;  // Brief in-context justification of the fat estimate (cooking method + per-component fat). Forces the model to reason before committing numbers; logged for debugging, not shown to the user.
  carbs: number;
  protein: number;
  fat: number;
  fiber: number;
  alcohol: number;  // Grams of alcohol (beer, wine, spirits, etc.)
  cookingOilAdded: number;  // Grams of cooking oil/fat added during preparation
  foodItemMacros?: FoodItemMacro[];
}

export interface FoodAnalysis {
  description: string;
  shortDescription: string;  // 3-4 word description for meal log
  foodQuantities: string;  // Estimated quantities of main food components
  carbs: number;
  protein: number;
  fat: number;
  fiber: number;
  calories: number;
  alcohol?: number;  // Grams of alcohol if applicable
  cookingOilAdded?: number;  // Grams of cooking oil added (for transparency)
  foodItemMacros?: FoodItemMacro[];
}

/**
 * Calculate calories from macronutrients using standard conversion factors:
 * - Carbohydrates: 4 cal/g
 * - Protein: 4 cal/g
 * - Fat: 9 cal/g
 * - Alcohol: 7 cal/g
 * 
 * Note: Fiber is included in carbs but provides ~2 cal/g instead of 4.
 * For simplicity, we use the standard formula. The difference is minimal
 * for typical fiber intake (e.g., 25g fiber = 50 cal difference).
 */
function calculateCaloriesFromMacros(macros: {
  carbs: number;
  protein: number;
  fat: number;
  alcohol?: number;
}): number {
  const carbCalories = macros.carbs * 4;
  const proteinCalories = macros.protein * 4;
  const fatCalories = macros.fat * 9;
  const alcoholCalories = (macros.alcohol || 0) * 7;
  
  return Math.round(carbCalories + proteinCalories + fatCalories + alcoholCalories);
}

/**
 * Convert raw LLM macro analysis to FoodAnalysis with calculated calories.
 * The fat value already includes any cooking oil added by the LLM. Oil/fat
 * plausibility is handled in-context by the model itself (it reasons about the
 * cooking method per-component in `fatReasoning` before committing numbers),
 * so we trust its macros here rather than post-processing with brittle rules.
 */
function convertToFoodAnalysis(raw: RawMacroAnalysis): FoodAnalysis {
  const calories = calculateCaloriesFromMacros({
    carbs: raw.carbs,
    protein: raw.protein,
    fat: raw.fat,
    alcohol: raw.alcohol,
  });

  return {
    description: raw.description,
    shortDescription: raw.shortDescription,
    foodQuantities: raw.foodQuantities,
    carbs: Math.round(raw.carbs),
    protein: Math.round(raw.protein),
    fat: Math.round(raw.fat),
    fiber: Math.round(raw.fiber),
    calories,
    alcohol: raw.alcohol > 0 ? Math.round(raw.alcohol) : undefined,
    foodItemMacros: raw.foodItemMacros,
    cookingOilAdded: raw.cookingOilAdded && raw.cookingOilAdded > 0 ? Math.round(raw.cookingOilAdded) : undefined,
  };
}

export const analyzeFoodImage = async (imageUri: string, userComments?: string): Promise<FoodAnalysis> => {
  glowLogger.info('Analyzing food image', { 
    image_uri: imageUri,
    has_user_comments: !!userComments,
    ...(userComments && { user_comments: userComments })
  });

  let base64Image: string;

  // Handle HTTP URLs (from simulator test images)
  if (imageUri.startsWith('http://') || imageUri.startsWith('https://')) {
    const localUri = FileSystem.cacheDirectory + 'temp_food_image.jpg';
    await FileSystem.downloadAsync(imageUri, localUri);
    base64Image = await FileSystem.readAsStringAsync(localUri, {
      encoding: FileSystem.EncodingType.Base64,
    });
  } else {
    base64Image = await FileSystem.readAsStringAsync(imageUri, {
      encoding: FileSystem.EncodingType.Base64,
    });
  }

  // Build prompt with optional user comments
  let prompt = `${buildLanguageInstruction()}

Analyze this food image and estimate MACRONUTRIENTS ONLY (calories will be calculated separately).

Provide:
1. A short 3-4 word description (e.g., "Chicken Caesar Salad", "Beef Burger Fries")
2. A brief full description of the food (12 words max)
3. Estimated quantities in grams of the main 3-5 food components, INCLUDING any cooking oil or sauce (e.g., "Pasta: ~120g, Ground beef: ~200g, Olive oil: ~15g, Salad: ~60g")
4. Estimated macros in grams: carbs, protein, fat, fiber
5. Estimated alcohol in grams (if applicable - see alcohol guidelines below)
6. Cooking oil/fat added during preparation in grams

IMPORTANT - ALCOHOL CONTENT ESTIMATION:
Always check if the food/drink contains alcohol. Common sources:
- Alcoholic beverages: beer (~13-14g per 350ml), wine (~14-16g per 150ml), cocktails (~14-20g per drink)
- Desserts with alcohol: tiramisu (~5-8g rum/Marsala), Black Forest Gateau (~3-5g Kirschwasser), rum cake (~8-12g), trifle (~4-6g sherry), profiteroles with liqueur (~3-5g)
- Savory dishes: coq au vin (~8-12g wine), beef bourguignon (~10-15g wine), penne alla vodka (~2-4g vodka), beer-battered foods (~5-8g beer)
- Flambéed dishes: crêpes Suzette (~5-8g), bananas Foster (~6-10g)
- Note: Some alcohol evaporates during cooking (30-85% depending on method/time), but residual alcohol remains
- If unsure about alcohol content in a traditional recipe, estimate conservatively based on typical recipes

IMPORTANT - COOKING OIL & SAUCE ESTIMATION:
Always consider how the food was likely prepared. Add realistic cooking oil/fat estimates based on cuisine type:
- Asian stir-fry dishes (Thai, Chinese, etc.): typically 15-25g oil
- Pan-fried/sautéed items: typically 10-20g oil
- Deep-fried foods: typically 20-40g absorbed oil
- Grilled meats: typically 5-10g oil/fat
- Dressed salads: typically 10-20g dressing (mostly fat)
- Roasted vegetables: typically 10-15g oil
- NO added oil for: raw foods, steamed items, porridge/oatmeal, plain rice, boiled foods, fresh fruit

Include any visible sauces/dressings in the fat estimate. If sauce is visible but type unclear, assume a moderate amount (~10-15g).

MANDATORY: Do NOT output near-zero oil (0-2g) for any fried, deep-fried, stir-fried, sautéed, pan-fried, curried, or roasted dish. These are cooked in fat — respect the ranges above. A curry/stir-fry with only 1-2g oil is almost always wrong; underestimating fat severely undercounts calories.

The "fat" value should INCLUDE the cooking oil. The "cookingOilAdded" field shows how much of the fat came from cooking oil/added fats (for transparency).`;

  if (userComments && userComments.trim()) {
    prompt += `\n\nIMPORTANT: The user provided these specifications about the meal: "${userComments.trim()}"
Please incorporate these details into your analysis. For example:
- If they mention "very oily" or "extra oil", increase cooking oil estimate accordingly
- If they mention "large portion" or "extra serving", increase all macros proportionally
- If they mention "no oil" or "dry cooked", set cookingOilAdded to 0
- If they mention specific ingredients or modifications, adjust the description and nutrition values accordingly`;
  }

  prompt += `\n\n${FAT_REASONING_INSTRUCTION}

Respond in this exact JSON format:
{
  "shortDescription": "3-4 word description",
  "description": "brief full description here",
  "foodQuantities": "Component1: ~Xg, Component2: ~Yg, Cooking oil: ~Xg (if applicable)",
  "fatReasoning": "Method per item + per-component fat + sanity check, e.g. 'Potatoes boiled → 0g oil; chicken & veg sautéed in ~10g oil; chicken intrinsic ~4g → total ~14g fat'",
  "foodItemMacros": [
    {"name": "Component1", "grams": 200, "carbs": 44, "protein": 4, "fat": 1, "fiber": 1},
    {"name": "Component2", "grams": 150, "carbs": 0, "protein": 31, "fat": 4, "fiber": 0}
  ],
  "carbs": 45,
  "protein": 25,
  "fat": 15,
  "fiber": 5,
  "alcohol": 0,
  "cookingOilAdded": 10
}

Notes:
- User-visible food text fields (shortDescription, description, foodQuantities, foodItemMacros.name) must follow the selected app language from the language instruction above. Keep JSON keys and numeric values unchanged.
- "foodItemMacros": per-item macro breakdown in grams — names and order must match foodQuantities. Include cooking oil as a separate item if applicable.
- "foodQuantities" component names must NOT contain commas. Use simple names like "Oatmeal", "Eggs", "Hazelnuts" — never "Oatmeal (with nuts, berries)".
- "fatReasoning": your per-component fat reasoning and sanity-check (see FAT SELF-CHECK above). Write it BEFORE the numeric fields so the numbers follow from the reasoning.
- "fat" should INCLUDE any cooking oil/added fats
- "cookingOilAdded" shows how much of the fat came from cooking (0 if none)
- "alcohol" in grams - check for alcohol in beverages, desserts, and cooked dishes (0 if none)
- Do NOT estimate calories - they will be calculated from macros

Only respond with the JSON, nothing else.`;

  let lastError: any;

  // Try GPT-5.1 for image analysis (primary), fallback to Claude
  for (let attempt = 1; attempt <= GPT5_MAX_RETRIES; attempt++) {
    try {
      glowLogger.info('Attempting GPT-5.1 food image analysis', {
        attempt,
        max_retries: GPT5_MAX_RETRIES
      });

      const response = await openai.chat.completions.create({
        model: 'gpt-5.1',
        max_completion_tokens: 700,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content: 'You are a food nutrition analyzer. Always respond with valid JSON only.'
          },
          {
            role: 'user',
            content: [
              {
                type: 'image_url',
                image_url: {
                  url: `data:image/jpeg;base64,${base64Image}`,
                },
              },
              {
                type: 'text',
                text: prompt,
              },
            ],
          }
        ],
      });

      const textContent = response.choices[0]?.message?.content || '';
      glowLogger.info('GPT-4o raw response', { content: textContent.substring(0, 500) });
      
      const rawAnalysis: RawMacroAnalysis = parseJsonFromLLMResponse(textContent);
      const analysis = convertToFoodAnalysis(rawAnalysis);
      glowLogger.info('Food image analysis complete via GPT-4o', { 
        raw: rawAnalysis, 
        calculated: analysis, 
        attempt 
      });
      return analysis;

    } catch (error) {
      lastError = error;
      const errorDetails: any = {
        attempt,
        error_message: error instanceof Error ? error.message : String(error),
        error_type: error?.constructor?.name,
      };
      
      // Capture additional error details
      if (error && typeof error === 'object') {
        if ('status' in error) errorDetails.status = error.status;
        if ('code' in error) errorDetails.code = error.code;
        if ('type' in error) errorDetails.type = error.type;
      }
      
      glowLogger.warn('GPT-4o food image analysis attempt failed', errorDetails);

      if (attempt < GPT5_MAX_RETRIES && isRetryableError(error)) {
        const retryDelay = calculateRetryDelay(attempt);
        glowLogger.info('Retrying GPT-4o food image analysis', {
          retry_delay_ms: retryDelay
        });
        await sleep(retryDelay);
      }
    }
  }

  // Fallback to Anthropic Sonnet 4.5 after GPT-4o fails 2 times
  const gptImageErrorDetails: any = {
    error_message: lastError instanceof Error ? lastError.message : String(lastError),
    error_type: lastError?.constructor?.name,
  };
  
  // Capture additional error details from GPT failure
  if (lastError && typeof lastError === 'object') {
    if ('status' in lastError) gptImageErrorDetails.status = lastError.status;
    if ('code' in lastError) gptImageErrorDetails.code = lastError.code;
    if ('type' in lastError) gptImageErrorDetails.type = lastError.type;
  }
  
  glowLogger.warn('GPT-4o failed 2 times, falling back to Anthropic Sonnet 4.5 for image analysis', {
    gpt5_error_details: gptImageErrorDetails,
  });

  try {
    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 700,
      messages: [{
        role: 'user',
        content: [
          {
            type: 'image',
            source: {
              type: 'base64',
              media_type: 'image/jpeg',
              data: base64Image,
            },
          },
          {
            type: 'text',
            text: prompt,
          }
        ],
      }],
    });

    const content = message.content[0];
    if (content.type !== 'text') {
      throw new Error('Unexpected response type from Anthropic API');
    }

    const rawAnalysis: RawMacroAnalysis = parseJsonFromLLMResponse(content.text);
    const analysis = convertToFoodAnalysis(rawAnalysis);
    glowLogger.info('Food image analysis complete via Anthropic Sonnet 4.5 fallback', { 
      raw: rawAnalysis, 
      calculated: analysis 
    });
    return analysis;

  } catch (anthropicError) {
    // Build detailed error information for both providers
    const gptErrorDetails: any = {
      error_message: lastError instanceof Error ? lastError.message : String(lastError),
      error_type: lastError?.constructor?.name,
    };
    if (lastError && typeof lastError === 'object') {
      if ('status' in lastError) gptErrorDetails.status = lastError.status;
      if ('code' in lastError) gptErrorDetails.code = lastError.code;
      if ('type' in lastError) gptErrorDetails.type = lastError.type;
    }
    
    const anthropicErrorDetails: any = {
      error_message: anthropicError instanceof Error ? anthropicError.message : String(anthropicError),
      error_type: anthropicError?.constructor?.name,
    };
    if (anthropicError && typeof anthropicError === 'object') {
      if ('status' in anthropicError) anthropicErrorDetails.status = anthropicError.status;
      if ('code' in anthropicError) anthropicErrorDetails.code = anthropicError.code;
      if ('type' in anthropicError) anthropicErrorDetails.type = anthropicError.type;
    }
    
    glowLogger.error('All LLM providers failed for food image analysis', {
      gpt5_error: gptErrorDetails,
      anthropic_error: anthropicErrorDetails,
    });
    throw new Error('Unable to analyze food image at this time. Please try again later.');
  }
};

export const analyzeFoodText = async (
  foodDescription: string,
  chatHistory?: string[]
): Promise<FoodAnalysis> => {
  glowLogger.info('Analyzing food from text', {
    food_description: foodDescription,
    has_chat_history: !!chatHistory,
    chat_history_length: chatHistory?.length || 0
  });

  // Format chat history if provided
  let chatHistoryContext = '';
  if (chatHistory && chatHistory.length > 0) {
    chatHistoryContext = `\n\nRecent chat history for context:\n${chatHistory.join('\n')}\n`;
  }

  const prompt = `${buildLanguageInstruction()}

Analyze this food description and estimate MACRONUTRIENTS ONLY (calories will be calculated separately).

Food description: "${foodDescription}"${chatHistoryContext}

Provide:
1. A short 3-4 word description (e.g., "Chicken Caesar Salad", "Beef Burger Fries")
2. A brief full description of the food (12 words max)
3. Estimated quantities in grams of the main 3-5 food components, INCLUDING any cooking oil or sauce (e.g., "Pasta: ~120g, Ground beef: ~200g, Olive oil: ~15g")
4. Estimated macros in grams: carbs, protein, fat, fiber
5. Estimated alcohol in grams (if applicable - see alcohol guidelines below)
6. Cooking oil/fat added during preparation in grams

IMPORTANT - ALCOHOL CONTENT ESTIMATION:
Always check if the food/drink contains alcohol. Common sources:
- Alcoholic beverages: beer (~13-14g per 350ml), wine (~14-16g per 150ml), cocktails (~14-20g per drink), spirits (~14g per 45ml shot)
- Desserts with alcohol: tiramisu (~5-8g rum/Marsala), Black Forest Gateau (~3-5g Kirschwasser), rum cake (~8-12g), trifle (~4-6g sherry), profiteroles with liqueur (~3-5g), zabaglione (~6-8g Marsala)
- Savory dishes: coq au vin (~8-12g wine), beef bourguignon (~10-15g wine), penne alla vodka (~2-4g vodka), beer-battered foods (~5-8g beer), risotto with wine (~4-6g)
- Flambéed dishes: crêpes Suzette (~5-8g), bananas Foster (~6-10g)
- Note: Some alcohol evaporates during cooking (30-85% depending on method/time), but residual alcohol remains
- If unsure about alcohol content in a traditional recipe, estimate conservatively based on typical recipes

IMPORTANT - COOKING OIL & SAUCE ESTIMATION:
Always consider how the food was likely prepared. Add realistic cooking oil/fat estimates based on cuisine type:
- Asian stir-fry dishes (Thai, Chinese, Vietnamese, etc.): typically 15-25g oil
- Indian curries: typically 15-30g oil/ghee
- Mexican dishes (tacos, burritos with meat): typically 10-15g oil
- Pan-fried/sautéed items: typically 10-20g oil
- Deep-fried foods (fries, fried chicken): typically 20-40g absorbed oil
- Grilled meats: typically 5-10g oil/fat
- Dressed salads: typically 10-20g dressing (mostly fat)
- Roasted vegetables: typically 10-15g oil
- Restaurant/takeout food: add extra 5-10g vs homemade (they use more oil)
- NO added oil for: raw foods, steamed items, porridge/oatmeal, plain rice, boiled foods, fresh fruit, yogurt, cereal with milk

Include any likely sauces/dressings based on the dish type. The "fat" value should INCLUDE the cooking oil.

MANDATORY: Do NOT output near-zero oil (0-2g) for any fried, deep-fried, stir-fried, sautéed, pan-fried, curried, or roasted dish. These are cooked in fat — respect the ranges above. A curry/stir-fry with only 1-2g oil is almost always wrong; underestimating fat severely undercounts calories.

Use the chat history context if relevant to understand references like "same meal as yesterday" or "log again the pancakes I mentioned earlier".

${FAT_REASONING_INSTRUCTION}

Respond in this exact JSON format:
{
  "shortDescription": "3-4 word description",
  "description": "brief full description here",
  "foodQuantities": "Component1: ~Xg, Component2: ~Yg, Cooking oil: ~Xg (if applicable)",
  "fatReasoning": "Method per item + per-component fat + sanity check, e.g. 'Potatoes boiled → 0g oil; chicken & veg sautéed in ~10g oil; chicken intrinsic ~4g → total ~14g fat'",
  "foodItemMacros": [
    {"name": "Component1", "grams": 200, "carbs": 44, "protein": 4, "fat": 1, "fiber": 1},
    {"name": "Component2", "grams": 150, "carbs": 0, "protein": 31, "fat": 4, "fiber": 0}
  ],
  "carbs": 45,
  "protein": 25,
  "fat": 15,
  "fiber": 5,
  "alcohol": 0,
  "cookingOilAdded": 10
}

Notes:
- User-visible food text fields (shortDescription, description, foodQuantities, foodItemMacros.name) must follow the selected app language from the language instruction above. Keep JSON keys and numeric values unchanged.
- "foodItemMacros": per-item macro breakdown in grams — names and order must match foodQuantities. Include cooking oil as a separate item if applicable.
- "foodQuantities" component names must NOT contain commas. Use simple names like "Oatmeal", "Eggs", "Hazelnuts" — never "Oatmeal (with nuts, berries)".
- "fatReasoning": your per-component fat reasoning and sanity-check (see FAT SELF-CHECK above). Write it BEFORE the numeric fields so the numbers follow from the reasoning.
- "fat" should INCLUDE any cooking oil/added fats
- "cookingOilAdded" shows how much of the fat came from cooking (0 if none)
- "alcohol" in grams - check for alcohol in beverages, desserts, and cooked dishes (0 if none)
- Do NOT estimate calories - they will be calculated from macros

Only respond with the JSON, nothing else.`;

  let lastError: any;

  // Try GPT-5.1 for text analysis (primary), fallback to Claude
  for (let attempt = 1; attempt <= GPT5_MAX_RETRIES; attempt++) {
    try {
      glowLogger.info('Attempting GPT-5.1 food text analysis', {
        attempt,
        max_retries: GPT5_MAX_RETRIES
      });

      const response = await openai.chat.completions.create({
        model: 'gpt-4o',
        max_completion_tokens: 700,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content: 'You are a food nutrition analyzer. Always respond with valid JSON only.'
          },
          {
            role: 'user',
            content: prompt,
          }
        ],
      });

      const textContent = response.choices[0]?.message?.content || '';
      glowLogger.info('GPT-4o text analysis raw response', { content: textContent.substring(0, 500) });
      
      const rawAnalysis: RawMacroAnalysis = parseJsonFromLLMResponse(textContent);
      const analysis = convertToFoodAnalysis(rawAnalysis);
      glowLogger.info('Food text analysis complete via GPT-4o', { 
        raw: rawAnalysis, 
        calculated: analysis, 
        attempt 
      });
      return analysis;

    } catch (error) {
      lastError = error;
      const errorDetails: any = {
        attempt,
        error_message: error instanceof Error ? error.message : String(error),
        error_type: error?.constructor?.name,
      };
      
      // Capture additional error details
      if (error && typeof error === 'object') {
        if ('status' in error) errorDetails.status = error.status;
        if ('code' in error) errorDetails.code = error.code;
        if ('type' in error) errorDetails.type = error.type;
      }
      
      glowLogger.warn('GPT-4o food text analysis attempt failed', errorDetails);

      if (attempt < GPT5_MAX_RETRIES && isRetryableError(error)) {
        const retryDelay = calculateRetryDelay(attempt);
        glowLogger.info('Retrying GPT-4o food text analysis', {
          retry_delay_ms: retryDelay
        });
        await sleep(retryDelay);
      }
    }
  }

  // Fallback to Anthropic Sonnet 4.5 after GPT-4o fails 2 times
  const gptTextErrorDetails: any = {
    error_message: lastError instanceof Error ? lastError.message : String(lastError),
    error_type: lastError?.constructor?.name,
  };
  
  // Capture additional error details from GPT failure
  if (lastError && typeof lastError === 'object') {
    if ('status' in lastError) gptTextErrorDetails.status = lastError.status;
    if ('code' in lastError) gptTextErrorDetails.code = lastError.code;
    if ('type' in lastError) gptTextErrorDetails.type = lastError.type;
  }
  
  glowLogger.warn('GPT-4o failed 2 times, falling back to Anthropic Sonnet 4.5 for text analysis', {
    gpt5_error_details: gptTextErrorDetails,
  });

  try {
    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 700,
      messages: [{
        role: 'user',
        content: prompt,
      }],
    });

    const content = message.content[0];
    if (content.type !== 'text') {
      throw new Error('Unexpected response type from Anthropic API');
    }

    const rawAnalysis: RawMacroAnalysis = parseJsonFromLLMResponse(content.text);
    const analysis = convertToFoodAnalysis(rawAnalysis);
    glowLogger.info('Food text analysis complete via Anthropic Sonnet 4.5 fallback', { 
      raw: rawAnalysis, 
      calculated: analysis 
    });
    return analysis;

  } catch (anthropicError) {
    // Build detailed error information for both providers
    const gptTextErrorDetails: any = {
      error_message: lastError instanceof Error ? lastError.message : String(lastError),
      error_type: lastError?.constructor?.name,
    };
    if (lastError && typeof lastError === 'object') {
      if ('status' in lastError) gptTextErrorDetails.status = lastError.status;
      if ('code' in lastError) gptTextErrorDetails.code = lastError.code;
      if ('type' in lastError) gptTextErrorDetails.type = lastError.type;
    }
    
    const anthropicTextErrorDetails: any = {
      error_message: anthropicError instanceof Error ? anthropicError.message : String(anthropicError),
      error_type: anthropicError?.constructor?.name,
    };
    if (anthropicError && typeof anthropicError === 'object') {
      if ('status' in anthropicError) anthropicTextErrorDetails.status = anthropicError.status;
      if ('code' in anthropicError) anthropicTextErrorDetails.code = anthropicError.code;
      if ('type' in anthropicError) anthropicTextErrorDetails.type = anthropicError.type;
    }
    
    glowLogger.error('All LLM providers failed for food text analysis', {
      gpt5_error: gptTextErrorDetails,
      anthropic_error: anthropicTextErrorDetails,
    });
    throw new Error('Unable to analyze food description at this time. Please try again later.');
  }
};

export const updateFoodAnalysisWithCorrection = async (
  currentAnalysis: FoodAnalysis,
  userCorrection: string,
  chatHistory?: string[]
): Promise<FoodAnalysis> => {
  glowLogger.info('Updating food analysis with correction', {
    current_analysis: currentAnalysis,
    correction: userCorrection,
    has_chat_history: !!chatHistory,
    chat_history_length: chatHistory?.length || 0
  });

  let chatHistoryContext = '';
  if (chatHistory && chatHistory.length > 0) {
    chatHistoryContext = `\n\nRecent chat history for context:\n${chatHistory.join('\n')}\n`;
  }

  const prompt = `${buildLanguageInstruction()}

I previously estimated this meal: ${currentAnalysis.description}

With these estimated quantities: ${currentAnalysis.foodQuantities || 'not available'}

And these nutrition values:
- Carbs: ~${currentAnalysis.carbs}g
- Protein: ~${currentAnalysis.protein}g
- Fat: ~${currentAnalysis.fat}g (including ~${currentAnalysis.cookingOilAdded || 0}g cooking oil)
- Fiber: ~${currentAnalysis.fiber}g
- Alcohol: ~${currentAnalysis.alcohol || 0}g

The user provided this correction: "${userCorrection}"${chatHistoryContext}

CRITICAL: The description, foodQuantities, foodItemMacros, and aggregate macros MUST all be consistent with each other after applying the correction. If the correction changes what food items are in the meal (e.g., "it was chicken not beef", "actually I had rice not pasta"), you MUST update ALL fields — description, foodQuantities, foodItemMacros, and macros — to reflect the corrected meal.

Only preserve existing quantity amounts (gram weights) when the user manually adjusted them AND the correction does not change those specific items. For example, if the user previously adjusted "Rice: ~250g" and now says "add extra sauce", keep rice at 250g but add the sauce.

Use the chat history context if relevant to understand the correction better. For example, if the user says "I meant the pancakes, not the scrambled eggs", the chat history will show what was previously logged or discussed.

You MUST recalculate and update the MACRONUTRIENT values based on this correction. Do NOT keep the original values unchanged unless the correction doesn't affect nutrition (e.g., "it looked good"). Apply the correction meaningfully.

For example:
- "extra BBQ sauce" → add ~5-10g carbs, ~2-3g fat
- "400g of meat instead of 200g" → double protein and fat
- "extra portion of rice" → add ~40g carbs
- "added a teaspoon of oil" → add ~5g fat to both "fat" and "cookingOilAdded"
- "no oil was used" → reduce fat by cookingOilAdded amount, set cookingOilAdded to 0
- "had a beer with it" → add ~13g alcohol (for 350ml beer)

MANDATORY: Do NOT output near-zero oil (0-2g) for any fried, deep-fried, stir-fried, sautéed, pan-fried, curried, or roasted dish unless the user explicitly said no oil was used. These are cooked in fat (curries/stir-fries typically 12-30g oil/ghee); underestimating fat severely undercounts calories.

${FAT_REASONING_INSTRUCTION}

Respond in this exact JSON format:
{
  "shortDescription": "3-4 word description",
  "description": "updated description incorporating the user's correction",
  "foodQuantities": "Component1: ~Xg, Component2: ~Yg, Cooking oil: ~Xg (if applicable)",
  "fatReasoning": "Method per item + per-component fat + sanity check, e.g. 'Potatoes boiled → 0g oil; chicken & veg sautéed in ~10g oil; chicken intrinsic ~4g → total ~14g fat'",
  "foodItemMacros": [
    {"name": "Component1", "grams": 200, "carbs": 44, "protein": 4, "fat": 1, "fiber": 1},
    {"name": "Component2", "grams": 150, "carbs": 0, "protein": 31, "fat": 4, "fiber": 0}
  ],
  "carbs": <recalculated value>,
  "protein": <recalculated value>,
  "fat": <recalculated value - must include cooking oil>,
  "fiber": <recalculated value>,
  "alcohol": <grams of alcohol, 0 if none>,
  "cookingOilAdded": <grams of cooking oil in the fat total>
}

Notes:
- User-visible food text fields (shortDescription, description, foodQuantities, foodItemMacros.name) must follow the selected app language from the language instruction above. Keep JSON keys and numeric values unchanged.
- "foodItemMacros": per-item macro breakdown in grams — names and order must match foodQuantities. Include cooking oil as a separate item if applicable.
- "foodQuantities" component names must NOT contain commas. Use simple names like "Oatmeal", "Eggs", "Hazelnuts" — never "Oatmeal (with nuts, berries)".
- "fatReasoning": your per-component fat reasoning and sanity-check (see FAT SELF-CHECK above). Write it BEFORE the numeric fields so the numbers follow from the reasoning.
- "fat" should INCLUDE any cooking oil/added fats
- "cookingOilAdded" shows how much of the fat came from cooking
- Do NOT estimate calories - they will be calculated from macros

Only respond with the JSON, nothing else.`;

  let lastError: any;

  for (let attempt = 1; attempt <= GPT5_MAX_RETRIES; attempt++) {
    try {
      glowLogger.info('Attempting GPT food correction', {
        attempt,
        max_retries: GPT5_MAX_RETRIES,
      });

      const message = await openai.chat.completions.create({
        model: 'gpt-5.1',
        max_completion_tokens: 700,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content: 'You are a food nutrition analyzer. Always respond with valid JSON only.'
          },
          { role: 'user', content: prompt },
        ],
      });

      const content = message.choices[0]?.message?.content || '';
      glowLogger.info('Raw LLM response for food correction', {
        content_length: content.length,
        content_preview: content.substring(0, 200),
      });

      if (!content || content.length === 0) {
        throw new Error('LLM returned empty response for food correction');
      }

      const rawAnalysis: RawMacroAnalysis = parseJsonFromLLMResponse(content);
      const updatedAnalysis = convertToFoodAnalysis(rawAnalysis);
      glowLogger.info('Food analysis updated via GPT', {
        raw: rawAnalysis,
        calculated: updatedAnalysis,
        attempt,
      });
      return updatedAnalysis;

    } catch (error) {
      lastError = error;
      const errorDetails: any = {
        attempt,
        error_message: error instanceof Error ? error.message : String(error),
        error_type: error?.constructor?.name,
      };
      if (error && typeof error === 'object') {
        if ('status' in error) errorDetails.status = error.status;
        if ('code' in error) errorDetails.code = error.code;
      }
      glowLogger.warn('GPT food correction attempt failed', errorDetails);

      if (attempt < GPT5_MAX_RETRIES && isRetryableError(error)) {
        const retryDelay = calculateRetryDelay(attempt);
        glowLogger.info('Retrying GPT food correction', { retry_delay_ms: retryDelay });
        await sleep(retryDelay);
      }
    }
  }

  // Fallback to Anthropic after GPT retries exhausted
  glowLogger.warn('GPT food correction failed, falling back to Anthropic', {
    gpt_error: lastError instanceof Error ? lastError.message : String(lastError),
  });

  try {
    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 700,
      messages: [{ role: 'user', content: prompt }],
    });

    const content = message.content[0];
    if (content.type !== 'text') {
      throw new Error('Unexpected response type from Anthropic API');
    }

    const rawAnalysis: RawMacroAnalysis = parseJsonFromLLMResponse(content.text);
    const updatedAnalysis = convertToFoodAnalysis(rawAnalysis);
    glowLogger.info('Food analysis updated via Anthropic fallback', {
      raw: rawAnalysis,
      calculated: updatedAnalysis,
    });
    return updatedAnalysis;

  } catch (anthropicError) {
    glowLogger.error('Both GPT and Anthropic failed for food correction', {
      gpt_error: lastError instanceof Error ? lastError.message : String(lastError),
      anthropic_error: anthropicError instanceof Error ? anthropicError.message : String(anthropicError),
    });
    throw anthropicError;
  }
};