# HomeTower - Native build and the push proof

The web staging build proves screens, engine and freshness logic. Two
things only a NATIVE build can prove (stated plainly, never faked from
web): an Expo push token, and ML Kit OCR on device. This file is the
prepared path; the build itself runs with the owner, step by step.

## Prepared in the repo
- app/eas.json: development profile (dev client, internal distribution)
- app/app.json: bundle id com.harel.hometower (iOS + Android), plugins
  expo-notifications and expo-image-picker declared
- Push module rules already in code (PHASE1.md): static import,
  token-backed enabled, visible diagnostics, default ON

## What the build needs from the owner (once)
1. An Expo account login on the machine that runs the build (his Mac,
   like the TReps flow)
2. His Apple ID for the development build install (EAS prompts for it)

## Status (2026-11-08)
- EAS project created and linked: @aharel/hometower, projectId
  6cad0ddf-e2eb-490e-81e5-519e48006ba3 (also written into app.json
  extra.eas.projectId in the repo, so a fresh clone is pre-linked).
- expo-dev-client (~6.0.21) added to dependencies + entry import -
  the development profile requires it; the first build attempt
  caught its absence.
- BUILD BLOCKED (owner decision 2026-11-08: stop here, complete
  when he says): the owner's Apple ID (harel.y.a@gmail.com) has NO
  paid Apple Developer Program membership - "You have no team
  associated with your Apple account". EAS cannot create signing
  credentials without it. A free/personal team cannot substitute:
  free provisioning does not include the Push Notifications
  entitlement, which is the entire point of this build. Resume =
  enroll in the Apple Developer Program ($99/yr, the item already
  PAUSED on the app-payments list), let the membership activate,
  then run the build command below and finish the push proof.

## Commands (run together, one confirmed step at a time)
    cd app
    npx eas-cli build --profile development --platform ios

## The push proof (on the phone, in order)
1. Install the dev build, open HomeTower
2. Intake tab -> Push reminders: setting ON (default) -> Register
3. PASS requires the diagnostics to show: permission granted, token
   STORED, stage done. Anything else is the failure, shown by stage
4. Add a payslip with an old capture date in Documents (it goes stale)
5. Home shows the stale alert; the scheduled local reminder fires at
   the next 9:00 AM slot - and the scheduled count in diagnostics is 1+
6. Only then is Phase 1 push called proven
