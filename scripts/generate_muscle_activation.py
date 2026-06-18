#!/usr/bin/env python3
"""Author per-exercise muscleActivation (primary+secondary synergists) for the catalog.
Rule-based: explicit overrides for special cases, else movement-keyword synergists.
Levels: 3 primary, 2 secondary, 1 stabilizer. Idempotent; re-run after catalog edits."""
import json, re
PATH='assets/exercises/exercises.json'
d=json.load(open(PATH)); ex=d['exercises']

def acts(*pairs):
    return [{'slug':s,'level':l} for s,l in pairs]

# Explicit per-id activation where keyword rules would be wrong or need precision.
EXPLICIT={
 # --- posterior chain / hinges (muscleGroup back or legs but hamstring/erector driven) ---
 'good-morning':acts(('hamstring',3),('lower-back',3),('gluteal',2)),
 'back-extension':acts(('lower-back',3),('gluteal',2),('hamstring',2)),
 'rack-pull':acts(('lower-back',3),('trapezius',2),('upper-back',2),('hamstring',2),('gluteal',2),('forearm',1)),
 'barbell-deadlift':acts(('hamstring',3),('gluteal',3),('lower-back',3),('quadriceps',2),('trapezius',2),('forearm',2),('upper-back',1)),
 'dumbbell-deadlift':acts(('hamstring',3),('gluteal',3),('lower-back',2),('quadriceps',2),('forearm',2)),
 'trap-bar-deadlift':acts(('quadriceps',3),('gluteal',3),('hamstring',2),('lower-back',2),('trapezius',2),('forearm',2)),
 'stiff-leg-deadlift':acts(('hamstring',3),('gluteal',2),('lower-back',2)),
 'romanian-deadlift':acts(('hamstring',3),('gluteal',3),('lower-back',2),('forearm',1)),
 'single-leg-romanian-deadlift':acts(('hamstring',3),('gluteal',3),('lower-back',1),('abs',1)),
 'sumo-deadlift':acts(('gluteal',3),('quadriceps',2),('hamstring',2),('adductors',2),('lower-back',2),('trapezius',1),('forearm',1)),
 'nordic-hamstring-curl':acts(('hamstring',3),('gluteal',1)),
 # --- glutes ---
 'hip-thrust':acts(('gluteal',3),('hamstring',2),('quadriceps',1)),
 'glute-bridge':acts(('gluteal',3),('hamstring',2)),
 'cable-pull-through':acts(('gluteal',3),('hamstring',2),('lower-back',1)),
 'kettlebell-swing':acts(('gluteal',3),('hamstring',2),('lower-back',2),('quadriceps',1),('deltoids',1),('forearm',1)),
 'cable-kickback':acts(('gluteal',3),('hamstring',1)),
 'glute-kickback':acts(('gluteal',3),('hamstring',1)),
 'donkey-kick':acts(('gluteal',3),('hamstring',1)),
 'hip-abduction':acts(('gluteal',3),('adductors',1)),
 'clamshell':acts(('gluteal',3),),
 '90-90-hip-switch':acts(('gluteal',2),('adductors',1)),
 'hip-adduction-machine':acts(('adductors',3),('gluteal',1)),
 # --- adductor-emphasis lower compounds ---
 'lateral-squat':acts(('adductors',3),('quadriceps',2),('gluteal',2)),
 'lateral-lunge':acts(('adductors',3),('quadriceps',2),('gluteal',2)),
 'cossack-squat':acts(('adductors',3),('quadriceps',2),('gluteal',2),('hamstring',1)),
 'sumo-squat':acts(('quadriceps',3),('gluteal',3),('adductors',2),('hamstring',1)),
 # --- calves ---
 'jump-rope':acts(('calves',3),('quadriceps',1)),
 'tibialis-raise':acts(('tibialis',3),),
 'ankle-rocks':acts(('calves',1),('tibialis',1)),
 # --- abs / core ---
 'plank':acts(('abs',3),('obliques',1)),
 'hollow-body-hold':acts(('abs',3),),
 'l-sit':acts(('abs',3),('quadriceps',1)),
 'dead-bug':acts(('abs',3),),
 'ab-rollout':acts(('abs',3),('lower-back',1)),
 'hanging-leg-raise':acts(('abs',3),('forearm',1)),
 'toes-to-bar':acts(('abs',3),('forearm',1),('upper-back',1)),
 'mountain-climber':acts(('abs',3),('quadriceps',2),('deltoids',1)),
 'burpee':acts(('quadriceps',2),('chest',2),('abs',2),('deltoids',1),('triceps',1)),
 'jumping-jack':acts(('calves',2),('deltoids',2),('quadriceps',1)),
 'bear-crawl':acts(('abs',3),('deltoids',2),('quadriceps',2),('triceps',1)),
 'farmers-walk':acts(('forearm',3),('trapezius',2),('abs',2),('gluteal',1)),
 'suitcase-carry':acts(('obliques',3),('forearm',2),('trapezius',1),('abs',1)),
 # --- obliques ---
 'side-plank':acts(('obliques',3),('abs',1)),
 'side-plank-knees-bent':acts(('obliques',3),('abs',1)),
 'russian-twist':acts(('obliques',3),('abs',2)),
 'bicycle-crunch':acts(('abs',3),('obliques',2)),
 'woodchop':acts(('obliques',3),('abs',1),('deltoids',1)),
 'pallof-press':acts(('obliques',3),('abs',2)),
 'standing-pallof-hold':acts(('obliques',3),('abs',2)),
 'copenhagen-plank':acts(('adductors',3),('obliques',2)),
 'oblique-crunch':acts(('obliques',3),('abs',1)),
 # --- shoulders specials ---
 'face-pull':acts(('deltoids',3),('trapezius',2),('upper-back',2)),
 'reverse-fly':acts(('deltoids',3),('upper-back',2),('trapezius',1)),
 'barbell-shrug':acts(('trapezius',3),('forearm',1)),
 'dumbbell-shrug':acts(('trapezius',3),('forearm',1)),
 'upright-row':acts(('deltoids',3),('trapezius',2),('biceps',1)),
 'clean-and-press':acts(('deltoids',3),('trapezius',2),('quadriceps',2),('gluteal',2),('triceps',1),('lower-back',1)),
 'battle-rope':acts(('deltoids',3),('forearm',2),('abs',2)),
 'shadow-boxing':acts(('deltoids',2),('obliques',2),('abs',1)),
 'band-pull-apart':acts(('deltoids',2),('upper-back',2),('trapezius',1)),
 'band-external-rotation':acts(('deltoids',2),),
 'prone-y-t-raises':acts(('deltoids',2),('trapezius',2),('upper-back',2)),
 'wall-slide':acts(('deltoids',1),('trapezius',1)),
 'scapular-push-up':acts(('trapezius',2),('chest',1)),
 'skin-the-cat':acts(('deltoids',2),('upper-back',2),('forearm',1)),
 # --- back specials (pulls / levers / cardio) ---
 'swimming':acts(('upper-back',3),('deltoids',2),('chest',1),('triceps',1)),
 'rowing-machine':acts(('upper-back',3),('quadriceps',2),('biceps',1),('lower-back',1)),
 'ski-erg':acts(('upper-back',3),('triceps',2),('abs',1),('lower-back',1)),
 'front-lever':acts(('upper-back',3),('abs',2),('forearm',1)),
 'tuck-front-lever':acts(('upper-back',3),('abs',2),('forearm',1)),
 'back-lever':acts(('upper-back',3),('chest',1),('forearm',1)),
 'human-flag':acts(('upper-back',3),('obliques',3),('deltoids',2),('forearm',1)),
 'muscle-up':acts(('upper-back',3),('biceps',2),('triceps',2),('chest',1)),
 'straight-arm-pulldown':acts(('upper-back',3),('triceps',1)),
 'bird-dog':acts(('lower-back',2),('abs',2),('gluteal',1)),
 'cat-cow':acts(('lower-back',1),('abs',1)),
 'thoracic-open-book':acts(('upper-back',1),('obliques',1)),
 # --- mobility / stretches (low) ---
 'worlds-greatest-stretch':acts(('hamstring',1),('adductors',1),('gluteal',1),('quadriceps',1)),
 'couch-stretch':acts(('quadriceps',1),),
 # --- chest specials ---
 'dumbbell-pullover':acts(('chest',3),('upper-back',2),('triceps',1)),
 'close-grip-bench-press':acts(('triceps',3),('chest',2),('deltoids',1)),
 'diamond-push-up':acts(('triceps',3),('chest',2),('deltoids',1)),
}

def primary_arms(name):
    n=name.lower()
    if 'wrist' in n: return acts(('forearm',3),)
    if 'hammer' in n: return acts(('biceps',3),('forearm',2))
    if any(k in n for k in ['tricep','pushdown','skull','extension','dip','close grip']):
        return acts(('triceps',3),)
    if 'curl' in n: return acts(('biceps',3),('forearm',1))
    return acts(('biceps',2),('triceps',2))

def keyword_activation(e):
    name=e['name'].lower(); idd=e['id']; g=e['muscleGroup']
    if g=='chest':
        a=acts(('chest',3),)
        if any(k in name for k in ['press','push-up','push up','dip']):
            a+=acts(('triceps',2),('deltoids',1))
        if 'fly' in name or 'crossover' in name or 'pec deck' in name:
            a+=acts(('deltoids',1),)
        return a
    if g=='shoulders':
        a=acts(('deltoids',3),)
        if 'press' in name: a+=acts(('triceps',2),('trapezius',1))
        if 'handstand' in name: a+=acts(('triceps',2),('abs',1))
        return a
    if g=='arms':
        return primary_arms(name)
    if g=='back':
        a=acts(('upper-back',3),)
        if any(k in name for k in ['row','pulldown','pull-up','pull up','chin-up','chin up','inverted']):
            a+=acts(('biceps',2),('forearm',1),('trapezius',1))
        if 'chin' in name: a+=acts(('biceps',1),)
        return a
    if g=='quads':
        a=acts(('quadriceps',3),)
        if 'squat' in name: a+=acts(('gluteal',2),('hamstring',1),('adductors',1))
        return a
    if g=='hamstrings':
        return acts(('hamstring',3),('gluteal',1))
    if g=='glutes':
        return acts(('gluteal',3),('hamstring',1))
    if g=='adductors':
        return acts(('adductors',3),)
    if g=='calves':
        return acts(('calves',3),)
    if g=='abs':
        return acts(('abs',3),)
    if g=='obliques':
        return acts(('obliques',3),('abs',1))
    if g=='legs':
        a=acts(('quadriceps',3),)
        if any(k in name for k in ['run','walk','hiking','cycl','elliptical','stair','sprint','ruck','bike']):
            a+=acts(('hamstring',2),('gluteal',2),('calves',2))
        elif any(k in name for k in ['jump','box','thruster']):
            a+=acts(('gluteal',2),('calves',2),('hamstring',1))
        else:  # squats / lunges / leg press / step-ups
            a+=acts(('gluteal',2),('hamstring',1),('adductors',1))
        return a
    return acts(('abs',1),)

def merge(a):
    m={}
    for it in a:
        s=it['slug']; m[s]=max(m.get(s,0),it['level'])
    # ordered: by level desc then slug
    return [{'slug':s,'level':l} for s,l in sorted(m.items(), key=lambda kv:(-kv[1],kv[0]))]

for e in ex:
    a = EXPLICIT.get(e['id']) or keyword_activation(e)
    e['muscleActivation']=merge(a)

d['version']='1.2.0'; d['lastUpdated']='2026-06-02'
json.dump(d, open(PATH,'w'), indent=2, ensure_ascii=False); open(PATH,'a').write('\n')

# spot-check
checks=['barbell-bench-press','barbell-back-squat','barbell-deadlift','pull-up','good-morning',
        'plank','running','romanian-deadlift','hip-thrust','dumbbell-curl','standing-calf-raise',
        'incline-cable-fly','hip-adduction-machine','side-plank','lateral-lunge']
for c in checks:
    e=next(x for x in ex if x['id']==c)
    print(f"{c:26}", e['muscleActivation'])
miss=[e['id'] for e in ex if not e.get('muscleActivation')]
print('exercises without activation:', miss)
print('TOTAL:', len(ex))
