UPDATE `registrations`
SET
	`state_version` = `state_version` + 1,
	`nickname_sync_status` = 'PENDING',
	`role_sync_status` = 'PENDING',
	`updated_at` = CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER)
WHERE `status` = 'REGISTERED'
	AND `name_visibility` = 'HIDDEN'
	AND `is_present` = 1;
--> statement-breakpoint
INSERT INTO `pending_operations` (
	`id`,
	`guild_id`,
	`user_id`,
	`operation_type`,
	`payload`,
	`priority`,
	`state_version`,
	`deduplication_key`,
	`attempt_count`,
	`next_attempt_at`,
	`last_error_code`,
	`terminal`,
	`lease_owner`,
	`lease_expires_at`,
	`created_at`,
	`updated_at`
)
SELECT
	lower(hex(randomblob(16))),
	`guild_id`,
	`user_id`,
	'SET_NICKNAME',
	'{"reconcile":true}',
	50,
	`state_version`,
	`guild_id` || ':' || `user_id` || ':RECONCILE',
	0,
	CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER),
	NULL,
	0,
	NULL,
	NULL,
	CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER),
	CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER)
FROM `registrations`
WHERE `status` = 'REGISTERED'
	AND `name_visibility` = 'HIDDEN'
	AND `is_present` = 1
ON CONFLICT (`deduplication_key`) DO UPDATE SET
	`payload` = excluded.`payload`,
	`priority` = excluded.`priority`,
	`state_version` = excluded.`state_version`,
	`attempt_count` = 0,
	`next_attempt_at` = excluded.`next_attempt_at`,
	`last_error_code` = NULL,
	`terminal` = 0,
	`lease_owner` = NULL,
	`lease_expires_at` = NULL,
	`updated_at` = excluded.`updated_at`;
