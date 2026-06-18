#!/usr/bin/env node

const { createClient } = require('@supabase/supabase-js');
const Anthropic = require('@anthropic-ai/sdk');
const readline = require('readline');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function askQuestion(question) {
  return new Promise((resolve) => {
    rl.question(question, resolve);
  });
}

// Initialize Supabase (you'll need to set SUPABASE_URL and SUPABASE_ANON_KEY env vars)
const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

// Initialize Anthropic
const anthropic = new Anthropic({
  apiKey: process.env.EXPO_PUBLIC_ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY,
});

async function summarizeRationale(userId) {
  try {
    console.log(`\n🔍 Getting action plan rationale for user: ${userId}`);

    // 1. Get onboarding profile JSON from database
    const { data: userData, error } = await supabase
      .from('user_profiles')
      .select('onboarding_profile_json')
      .eq('user_id', userId)
      .single();

    if (error || !userData) {
      throw new Error(`User profile not found: ${error?.message || 'No data'}`);
    }

    const onboardingData = JSON.parse(userData.onboarding_profile_json);
    const originalRationale = onboardingData.actionPlan?.rationale;

    if (!originalRationale) {
      throw new Error('No action plan rationale found in onboarding data');
    }

    console.log(`\n📝 Original rationale (${originalRationale.length} chars):`);
    console.log('---');
    console.log(originalRationale);
    console.log('---');

    // 2. Generate summary using Anthropic
    console.log('\n🤖 Generating summary...');

    const response = await anthropic.messages.create({
      model: 'claude-3-haiku-20240307',
      max_tokens: 100,
      messages: [{
        role: 'user',
        content: `Please summarize the following action plan rationale in a maximum of 50 words. Keep it concise but capture the key points:

${originalRationale}`
      }]
    });

    const summary = response.content[0].text;

    console.log(`\n✨ Summary (${summary.length} chars):`);
    console.log('---');
    console.log(summary);
    console.log('---');

    // 3. Ask user for input
    const userInput = await askQuestion('\n❓ What would you like to do? (Type "ok" to save, or suggest changes): ');

    if (userInput.toLowerCase() === 'ok') {
      // 4. Save the summarized rationale
      console.log('\n💾 Saving summarized rationale...');

      onboardingData.actionPlan.rationale = summary;

      const { error: updateError } = await supabase
        .from('user_profiles')
        .update({
          onboarding_profile_json: JSON.stringify(onboardingData)
        })
        .eq('user_id', userId);

      if (updateError) {
        throw new Error(`Failed to save: ${updateError.message}`);
      }

      console.log('✅ Successfully saved summarized rationale to database!');
    } else {
      console.log(`\n📝 You suggested: "${userInput}"`);
      console.log('Rationale not saved. Run the script again to try with different changes.');
    }

  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    rl.close();
  }
}

// Main execution
async function main() {
  const args = process.argv.slice(2);

  if (args.length !== 1) {
    console.log('Usage: node scripts/summarize-rationale.js <user_id>');
    console.log('Make sure to set environment variables: SUPABASE_URL, SUPABASE_ANON_KEY, ANTHROPIC_API_KEY');
    process.exit(1);
  }

  const userId = args[0];
  await summarizeRationale(userId);
}

main().catch(console.error);
