#!/usr/bin/env node

/**
 * Migrate old action plans to the new 3-fixed-step structure:
 *   step_1: Training
 *   step_2: Nutrition  
 *   step_3: Recovery & Sleep
 *
 * Usage: node scripts/migrate-plan-structure.js <user_id>
 */

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const Anthropic = require('@anthropic-ai/sdk');
const readline = require('readline');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function ask(question) {
  return new Promise((resolve) => {
    rl.question(question, resolve);
  });
}

// Initialize Supabase
const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ Missing Supabase environment variables');
  console.error('Required: EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY (or without EXPO_PUBLIC_ prefix)');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

// Initialize Anthropic
const anthropicKey = process.env.EXPO_PUBLIC_ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY;
if (!anthropicKey) {
  console.error('❌ Missing Anthropic API key');
  console.error('Required: EXPO_PUBLIC_ANTHROPIC_API_KEY or ANTHROPIC_API_KEY');
  process.exit(1);
}

const anthropic = new Anthropic({ apiKey: anthropicKey });

const SECTION_LABELS = { step_1: 'Training', step_2: 'Nutrition', step_3: 'Recovery & Sleep' };

async function migratePlanStructure(userId) {
  try {
    console.log(`\n🔍 Fetching action plan for user: ${userId}`);

    // 1. Fetch from Supabase
    const { data: userData, error } = await supabase
      .from('user_profile')
      .select('onboarding_profile_json')
      .eq('user_id', userId)
      .single();

    if (error || !userData) {
      throw new Error(`User profile not found: ${error?.message || 'No data'}`);
    }

    const onboardingData = JSON.parse(userData.onboarding_profile_json);
    const oldSteps = onboardingData.actionPlan?.steps;

    if (!oldSteps || oldSteps.length === 0) {
      throw new Error('No action plan steps found for this user');
    }

    // Check if already migrated
    const alreadyMigrated =
      oldSteps.length === 3 &&
      oldSteps[0]?.id === 'step_1' &&
      oldSteps[1]?.id === 'step_2' &&
      oldSteps[2]?.id === 'step_3';

    if (alreadyMigrated) {
      console.log('✅ Plan already uses the new step_1/step_2/step_3 structure.');
      const proceed = await ask('Force re-migration anyway? (y/N): ');
      if (proceed.toLowerCase() !== 'y') {
        console.log('Nothing to do.');
        return;
      }
    }

    // 2. Show current plan
    console.log(`\n📋 CURRENT PLAN (${oldSteps.length} steps):`);
    console.log('─'.repeat(60));
    oldSteps.forEach((step, i) => {
      const dim = step.wellness_dimension || '(none)';
      const tt = step.task_type || '(none)';
      console.log(`  ${i + 1}. [${step.id}] "${step.title}"`);
      console.log(`     wellness_dimension: ${dim}  |  task_type: ${tt}`);
      console.log(`     days: ${(step.daysOfWeek || []).join(', ') || 'N/A'}  |  time: ${step.timeOfDay || 'N/A'}`);
      console.log(`     description: ${(step.description || '').substring(0, 120)}${(step.description || '').length > 120 ? '...' : ''}`);
      console.log('');
    });
    console.log('─'.repeat(60));

    // 3. Call LLM to rearrange
    console.log('\n🤖 Asking Claude to rearrange into Training / Nutrition / Recovery & Sleep...\n');

    const llmPrompt = `You are given an existing health action plan with ${oldSteps.length} steps. Your job is to rearrange them into EXACTLY 3 steps that follow a fixed structure:

step_1: TRAINING - everything related to workouts, exercise, physical activity, movement
step_2: NUTRITION - everything related to diet, meals, supplements, eating habits
step_3: RECOVERY & SLEEP - everything related to sleep, recovery, stress management, relaxation, meditation

Here are the existing steps:
${JSON.stringify(oldSteps, null, 2)}

MAPPING RULES (CRITICAL):
1. Each old step maps to EXACTLY ONE new step - do not split content from a single old step across multiple new steps.
2. Priority for step_1 (Training): If an old step has structured workout data (step_details with dayName/exercises array), it goes to step_1.
3. If a step covers BOTH training AND nutrition (e.g., "tracking workouts and nutrition"):
   - If another step already has the workout program (exercises/sets/reps), assign the mixed step entirely to step_2 (Nutrition)
   - If no dedicated workout program exists, assign the mixed step to step_1 (Training)
4. Each new step should receive content from only ONE old step. If you have fewer than 3 old steps, create minimal placeholders for empty categories.

CONTENT PRESERVATION:
1. Copy all content VERBATIM - do NOT rewrite or paraphrase descriptions, rationales, or step_details
2. CRITICAL: Replace all special characters with standard ASCII equivalents:
   - Replace „" (German quotes) with regular double quotes ""
   - Replace ' ' (smart quotes) with regular single quotes ''
   - Replace – — (em/en dashes) with regular hyphens -
   - Replace • with standard bullet point *
3. Preserve existing fields: daysOfWeek, timeOfDay, bonus_hacks, detailed_rationale, step_details, step_title_scroll
4. Keep structured workout JSON (dayName/exercises) completely intact in step_1
5. Remove wellness_dimension and task_type fields (no longer used)
6. Each step MUST use exact ids: "step_1", "step_2", "step_3"

Also return a "mapping" array showing how each old step was mapped. Each entry:
{ "old_step_id": "...", "old_title": "...", "mapped_to": "step_1" OR "step_2" OR "step_3", "note": "brief explanation" }

Respond with ONLY valid JSON (no markdown, no code blocks):
{
  "steps": [ step_1_object, step_2_object, step_3_object ],
  "mapping": [ ... ]
}`;

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 16000,
      messages: [{ role: 'user', content: llmPrompt }]
    });

    let responseText = response.content[0].text.trim();

    // Strip markdown code blocks if present
    if (responseText.startsWith('```')) {
      const match = responseText.match(/```(?:json)?\s*\n([\s\S]*?)\n```/);
      if (match) {
        responseText = match[1].trim();
      }
    }

    // Clean up special characters that break JSON parsing
    responseText = responseText
      .replace(/[„"]/g, '"')  // German/smart quotes to regular quotes
      .replace(/['']/g, "'")  // Smart single quotes to regular quotes
      .replace(/[–—]/g, '-')  // Em/en dashes to hyphens
      .replace(/•/g, '*');    // Bullet points to asterisks

    let result;
    try {
      result = JSON.parse(responseText);
    } catch (parseError) {
      console.error('❌ Failed to parse LLM response as JSON');
      console.error(`Response length: ${responseText.length} characters`);
      console.error('Parse error:', parseError.message);
      console.error('\nFull response:');
      console.error(responseText);
      console.error('\n--- End of response ---\n');
      throw new Error('LLM returned invalid JSON');
    }

    const newSteps = result.steps;
    const mapping = result.mapping || [];

    if (!newSteps || newSteps.length !== 3) {
      throw new Error(`Expected exactly 3 steps, got ${newSteps?.length || 0}`);
    }

    // Validate step IDs
    if (newSteps[0].id !== 'step_1' || newSteps[1].id !== 'step_2' || newSteps[2].id !== 'step_3') {
      console.log('⚠️  Fixing step IDs...');
      newSteps[0].id = 'step_1';
      newSteps[1].id = 'step_2';
      newSteps[2].id = 'step_3';
    }

    // Validate one-to-one mapping
    const stepCounts = { step_1: 0, step_2: 0, step_3: 0 };
    mapping.forEach(m => {
      if (Array.isArray(m.mapped_to)) {
        console.log(`⚠️  Warning: Old step "${m.old_step_id}" mapped to multiple new steps. Using first target only.`);
        m.mapped_to = m.mapped_to[0];
      }
      stepCounts[m.mapped_to]++;
    });

    // Warn if any step received content from multiple old steps
    Object.entries(stepCounts).forEach(([stepId, count]) => {
      if (count > 1) {
        console.log(`⚠️  Warning: ${SECTION_LABELS[stepId]} (${stepId}) received content from ${count} old steps`);
      }
    });

    // Strip wellness_dimension and task_type if LLM left them
    newSteps.forEach(step => {
      delete step.wellness_dimension;
      delete step.task_type;
    });

    // 4. Show mapping
    console.log('📊 MAPPING: Old steps → New structure');
    console.log('═'.repeat(60));
    mapping.forEach(m => {
      const target = SECTION_LABELS[m.mapped_to] || m.mapped_to;
      console.log(`  "${m.old_title}" (${m.old_step_id})`);
      console.log(`    → ${target}`);
      if (m.note) console.log(`    💬 ${m.note}`);
      console.log('');
    });

    // 5. Show new plan
    console.log('📋 NEW PLAN STRUCTURE:');
    console.log('═'.repeat(60));
    newSteps.forEach((step) => {
      const label = SECTION_LABELS[step.id] || step.id;
      console.log(`  ${label} [${step.id}]: "${step.title}"`);
      console.log(`     days: ${(step.daysOfWeek || []).join(', ') || 'N/A'}  |  time: ${step.timeOfDay || 'N/A'}`);
      console.log(`     description: ${(step.description || '').substring(0, 120)}${(step.description || '').length > 120 ? '...' : ''}`);
      if (step.nutrition_targets) {
        const nt = step.nutrition_targets;
        console.log(`     nutrition_targets: ${nt.caloriesTarget} kcal | P:${nt.proteinTarget}g C:${nt.carbsTarget}g F:${nt.fatTarget}g Fiber:${nt.fiberTarget}g`);
      }
      const sd = step.step_details;
      if (sd) {
        if (typeof sd === 'string') {
          console.log(`     step_details: (text, ${sd.length} chars)`);
        } else if (Array.isArray(sd) && sd.length > 0 && sd[0]?.dayName) {
          console.log(`     step_details: (structured workout, ${sd.length} day(s))`);
        } else if (Array.isArray(sd)) {
          console.log(`     step_details: (${sd.length} text blocks)`);
        } else if (sd.dayName) {
          console.log(`     step_details: (single workout: ${sd.dayName})`);
        } else {
          console.log(`     step_details: (object)`);
        }
      }
      console.log('');
    });
    console.log('═'.repeat(60));

    // 6. Ask for confirmation
    const confirm = await ask('\n❓ Save this migrated plan to Supabase? (ok / cancel): ');

    if (confirm.toLowerCase() === 'ok' || confirm.toLowerCase() === 'y' || confirm.toLowerCase() === 'yes') {
      console.log('\n💾 Saving migrated plan...');

      onboardingData.actionPlan.steps = newSteps;

      const { error: updateError } = await supabase
        .from('user_profile')
        .update({
          onboarding_profile_json: JSON.stringify(onboardingData)
        })
        .eq('user_id', userId);

      if (updateError) {
        throw new Error(`Failed to save: ${updateError.message}`);
      }

      console.log('✅ Successfully migrated plan to new structure!');
      console.log('   step_1: Training');
      console.log('   step_2: Nutrition');
      console.log('   step_3: Recovery & Sleep');

    } else {
      console.log('\n❌ Migration cancelled. No changes saved.');
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
    console.log('Usage: node scripts/migrate-plan-structure.js <user_id>');
    console.log('');
    console.log('Migrates an old action plan to the new fixed 3-step structure:');
    console.log('  step_1: Training');
    console.log('  step_2: Nutrition');
    console.log('  step_3: Recovery & Sleep');
    console.log('');
    console.log('Required env vars: EXPO_PUBLIC_SUPABASE_URL, EXPO_PUBLIC_SUPABASE_ANON_KEY, ANTHROPIC_API_KEY');
    process.exit(1);
  }

  await migratePlanStructure(args[0]);
}

main().catch(console.error);
