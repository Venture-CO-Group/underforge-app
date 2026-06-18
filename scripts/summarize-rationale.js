#!/usr/bin/env node

require('dotenv').config();
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
      .from('user_profile')
      .select('onboarding_profile_json')
      .eq('user_id', userId)
      .single();

    if (error || !userData) {
      throw new Error(`User profile not found: ${error?.message || 'No data'}`);
    }

    const onboardingData = JSON.parse(userData.onboarding_profile_json);
    const originalRationale = onboardingData.actionPlan?.rationale;
    const actionSteps = onboardingData.actionPlan?.steps || [];

    if (!originalRationale) {
      throw new Error('No action plan rationale found in onboarding data');
    }

    // 2. Check and add wellness dimensions and task types if missing
    console.log(`\n🔍 Checking 3 steps for wellness dimensions and task types...`);

    // Assume if first step needs classification, all 3 steps need it
    const firstStep = actionSteps[0];
    const needsClassification = !firstStep?.wellness_dimension || !firstStep?.task_type;

    if (needsClassification) {
      console.log('🤖 Classifying all 3 steps...');

      // Store old classifications for comparison
      const oldClassifications = actionSteps.map((step, i) => ({
        step: i + 1,
        title: step.title,
        old_wellness: step.wellness_dimension || 'none',
        old_task: step.task_type || 'none'
      }));

      const classificationPrompt = `Classify these 3 wellness steps into wellness dimensions and task types.

Wellness Dimensions: nutrition, training, movement, stress_management, sleep, structure, recovery
Task Types: meal, workout, activity, meditation, sleep_routine, protocol

${actionSteps.map((step, i) => `Step ${i + 1}:
Title: ${step.title}
Description: ${step.description || 'N/A'}`).join('\n\n')}

Respond with ONLY a JSON array of 3 objects in this exact format:
[{"wellness_dimension": "dimension_name", "task_type": "task_name"}, {"wellness_dimension": "dimension_name", "task_type": "task_name"}, {"wellness_dimension": "dimension_name", "task_type": "task_name"}]`;

      const response = await anthropic.messages.create({
        model: 'claude-3-haiku-20240307',
        max_tokens: 200,
        messages: [{
          role: 'user',
          content: classificationPrompt
        }]
      });

      try {
        const classifications = JSON.parse(response.content[0].text.trim());

        if (Array.isArray(classifications) && classifications.length === 3) {
          console.log('\n📊 Classification Changes:');
          console.log('Step | Title | Old Classification → New Classification');
          console.log('-----|-------|-------------------→-------------------');

          classifications.forEach((classification, i) => {
            const oldWellness = oldClassifications[i].old_wellness;
            const oldTask = oldClassifications[i].old_task;
            const newWellness = classification.wellness_dimension;
            const newTask = classification.task_type;

            console.log(`${i + 1}    | ${oldClassifications[i].title.substring(0, 15)}${oldClassifications[i].title.length > 15 ? '...' : ''} | ${oldWellness}/${oldTask} → ${newWellness}/${newTask}`);

            // Update the steps with new classifications
            actionSteps[i].wellness_dimension = newWellness;
            actionSteps[i].task_type = newTask;
          });

          console.log('💾 Updating onboarding data with classifications...');
          // Note: This preserves ALL other information in steps, only adds wellness_dimension and task_type
          onboardingData.actionPlan.steps = actionSteps;

          const { error: classificationError } = await supabase
            .from('user_profile')
            .update({
              onboarding_profile_json: JSON.stringify(onboardingData)
            })
            .eq('user_id', userId);

          if (classificationError) {
            console.error('❌ Failed to save classifications:', classificationError);
          } else {
            console.log('✅ Classifications saved successfully!');
          }
        } else {
          console.log('❌ Invalid classification response format');
        }
      } catch (parseError) {
        console.log('❌ Failed to parse classifications');
        console.log('Response:', response.content[0].text);
      }
    } else {
      console.log('✅ All steps already have wellness dimensions and task types');
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
        content: `Please summarize the following action plan rationale in 40 words or less. Keep it very concise but capture the key points:

${originalRationale}

Summary (under 40 words):`
      }]
    });

    const summary = response.content[0].text;

    console.log('\n📊 Rationale Changes:');
    console.log('Type      | Content');
    console.log('----------|--------');
    console.log(`Original  | ${originalRationale.substring(0, 60)}${originalRationale.length > 60 ? '...' : ''}`);
    console.log(`Summary   | ${summary.substring(0, 60)}${summary.length > 60 ? '...' : ''}`);

    console.log('\n📄 Full Summary:');
    console.log('---');
    console.log(summary);
    console.log('---');

    // 3. Ask user for input
    const userInput = await askQuestion('\n❓ What would you like to do? (Type "ok" to save, or suggest changes): ');

    if (userInput.toLowerCase() === 'ok') {
      // 4. Save the summarized rationale
      // Note: This preserves ALL other information in the plan and step JSON format
      // Only updates rationale field (classifications were already updated earlier)
      console.log('\n💾 Saving summarized rationale...');

      onboardingData.actionPlan.rationale = summary;

      const { error: updateError } = await supabase
        .from('user_profile')
        .update({
          onboarding_profile_json: JSON.stringify(onboardingData)
        })
        .eq('user_id', userId);

      if (updateError) {
        console.error('Supabase update error details:', updateError);
        throw new Error(`Failed to save: ${updateError.message || 'Unknown error'}`);
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
    console.log('Make sure .env file exists with: EXPO_PUBLIC_SUPABASE_URL, EXPO_PUBLIC_SUPABASE_ANON_KEY, ANTHROPIC_API_KEY');
    process.exit(1);
  }

  const userId = args[0];
  await summarizeRationale(userId);
}

main().catch(console.error);
