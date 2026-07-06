# API Routes (generated 2026-07-05)
# 38 routes total.

## activities
POST         /api/activities/manual

## admin
GET          /api/admin/backups
DELETE       /api/admin/backups/:id
GET          /api/admin/backups/:id/download [cache]
POST         /api/admin/backups/export
POST         /api/admin/backups/restore
GET          /api/admin/backups/status
POST         /api/admin/login
POST         /api/admin/logout
GET          /api/admin/logs
POST         /api/admin/playground
GET          /api/admin/users
POST         /api/admin/users/:id/moderation

## athlete
POST,DELETE  /api/athlete/coach/disconnect

## coach
PATCH        /api/coach/links/:id/archive
POST         /api/coach/workouts

## cron
GET          /api/cron/backfill-watchdog
GET          /api/cron/backup-prune
GET          /api/cron/weekly-review-expiry

## integrations
GET          /api/integrations/strava/authorize
POST         /api/integrations/strava/backfill/retry
GET          /api/integrations/strava/callback
POST         /api/integrations/strava/connect
POST,DELETE  /api/integrations/strava/disconnect
POST         /api/integrations/strava/init
GET          /api/integrations/strava/mobile-bounce
POST         /api/integrations/strava/sync-workout
GET,POST     /api/integrations/strava/webhook

## join
POST         /api/join/coach

## onboarding
POST         /api/onboarding/save
GET          /api/onboarding/strava-status

## plans
POST         /api/plans

## theme
POST         /api/theme

## weekly-review
GET,POST     /api/weekly-review
GET          /api/weekly-review/:id
POST         /api/weekly-review/:id/accept
POST         /api/weekly-review/:id/reject

## workouts
POST         /api/workouts/:id/status
