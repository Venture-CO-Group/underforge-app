#!/usr/bin/env node
const Database = require('better-sqlite3');

const [,, userId, dbPath = 'longeviq.db'] = process.argv;

if (!userId) {
  console.error('Usage: node delete-workouts.js USER_ID [DB_PATH]');
  process.exit(1);
}

const db = new Database(dbPath);

try {
  const tx = db.transaction((uid) => {
    const delExercises = db.prepare(
      `DELETE FROM workout_exercise_logs
       WHERE workout_log_id IN (SELECT id FROM workout_logs WHERE user_id = ?)`
    ).run(uid);

    const delWorkouts = db.prepare(
      `DELETE FROM workout_logs WHERE user_id = ?`
    ).run(uid);

    return { exerciseChanges: delExercises.changes, workoutChanges: delWorkouts.changes };
  });

  const { exerciseChanges, workoutChanges } = tx(userId);
  console.log(`Deleted ${exerciseChanges} exercise rows and ${workoutChanges} workout rows for user ${userId}`);

  db.exec('VACUUM;');
  console.log('VACUUM completed.');
} catch (err) {
  console.error('Error:', err.message);
  process.exit(2);
} finally {
  db.close();
}