import { ActivityType, Client, Events, GatewayIntentBits } from "discord.js";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import type { Logger } from "pino";
import { commandDefinitions } from "./commands/definitions.js";
import { handleInteraction } from "./commands/interaction-handler.js";
import type { AppConfig } from "./config/schema.js";
import { assertDatabaseHealthy, createDatabase, type DatabaseContext } from "./database/client.js";
import { createGuildMemberAddHandler } from "./events/guild-member-add.js";
import { createGuildMemberRemoveHandler } from "./events/guild-member-remove.js";
import { createGuildMemberUpdateHandler } from "./events/guild-member-update.js";
import { CleanupWorker } from "./jobs/cleanup-worker.js";
import { DiscordOperationWorker } from "./jobs/discord-operation-worker.js";
import { MigrationWorker } from "./jobs/migration-worker.js";
import { RetentionWorker } from "./jobs/retention-worker.js";
import { RiotSyncWorker } from "./jobs/riot-sync-worker.js";
import { diagnoseGuild } from "./integrations/discord/diagnostics.js";
import { MemberReconciliationService } from "./integrations/discord/member-reconciliation-service.js";
import { RiotAccountService } from "./integrations/riot/riot-account-service.js";
import { Localizer } from "./localization/formatter.js";
import { LegacyNicknameParser } from "./parsers/legacy-nickname-parser.js";
import { AdministrativeNicknameParser } from "./parsers/administrative-nickname-parser.js";
import { OpggParser } from "./parsers/opgg-parser.js";
import { DiscordMemberMutationQueue } from "./queues/discord-member-mutation-queue.js";
import { RiotRequestQueue } from "./queues/riot-request-queue.js";
import { AuditRepository } from "./repositories/audit-repository.js";
import { MigrationRepository } from "./repositories/migration-repository.js";
import { PendingOperationRepository } from "./repositories/pending-operation-repository.js";
import { RegistrationRepository } from "./repositories/registration-repository.js";
import { WorkerLeaseRepository } from "./repositories/worker-lease-repository.js";
import { MemberStateReconciler } from "./services/member-state-reconciler.js";
import { MigrationService } from "./services/migration-service.js";
import { NicknameService } from "./services/nickname-service.js";
import { PermissionService } from "./services/permission-service.js";
import { RegistrationService } from "./services/registration-service.js";
import { AdministrativeNicknameService } from "./services/administrative-nickname-service.js";
import { LeagueRepository } from "./repositories/league-repository.js";
import { RiotLeagueService } from "./integrations/riot/riot-league-service.js";
import { LeagueStatsWorker } from "./jobs/league-stats-worker.js";
import { ChampionCatalog } from "./integrations/riot/champion-catalog.js";
import type { RankRoleIds, RankRoleKey } from "./types/domain.js";
import { createLeagueMentionHandler } from "./commands/league-mention-handler.js";
import { RankRoleStartupSweep } from "./services/rank-role-startup-sweep.js";
import { DiscordAuditOutboxRepository } from "./repositories/discord-audit-outbox-repository.js";
import { DiscordAuditPresenter } from "./services/discord-audit-presenter.js";
import { DiscordAuditLogWorker } from "./jobs/discord-audit-log-worker.js";

export class BotApplication {
	private readonly database: DatabaseContext;
	private readonly client: Client;
	private readonly discordQueue: DiscordMemberMutationQueue;
	private readonly riotQueue: RiotRequestQueue;
	private readonly workers: Array<{ start(): void; stop(): void }>;
	private readonly rankRoleSweep: RankRoleStartupSweep;
	private stopping = false;

	constructor(
		private readonly config: AppConfig,
		private readonly logger: Logger
	) {
		this.database = createDatabase(config.DATABASE_PATH);
		migrate(this.database.db, {
			migrationsFolder: "./src/database/migrations",
		});
		assertDatabaseHealthy(this.database);
		const intents = [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers];
		if (config.BOT_MENTION_COMMANDS_ENABLED) intents.push(GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent);
		this.client = new Client({ intents });
		const i18n = new Localizer(config.BOT_LOCALE, config.BOT_TIME_ZONE);
		const auditLogEnabled = Boolean(config.BOT_LOG_WEBHOOK_URL);
		const registrations = new RegistrationRepository(this.database, config.REGISTRATION_DATA_RETENTION_DAYS, auditLogEnabled);
		this.rankRoleSweep = new RankRoleStartupSweep(registrations, logger);
		const league = new LeagueRepository(this.database);
		const operations = new PendingOperationRepository(this.database);
		const migrations = new MigrationRepository(this.database);
		const audits = new AuditRepository(this.database, auditLogEnabled);
		const auditOutbox = new DiscordAuditOutboxRepository(this.database);
		const leases = new WorkerLeaseRepository(this.database);
		const permissions = new PermissionService(config);
		const nicknames = new NicknameService(config.UNREGISTERED_NICKNAME_TEMPLATE);
		const reconciler = new MemberStateReconciler(
			{
				named: config.VERIFIED_NAMED_ROLE_ID,
				private: config.VERIFIED_PRIVATE_ROLE_ID,
				unregistered: config.UNREGISTERED_ROLE_ID,
			},
			nicknames,
			rankRoleIds(config)
		);
		const reconciliation = new MemberReconciliationService(this.client, config, registrations, league, reconciler, audits, i18n, logger);
		this.discordQueue = new DiscordMemberMutationQueue(config.DISCORD_MEMBER_MUTATION_CONCURRENCY, config.DISCORD_MEMBER_MUTATION_MIN_DELAY_MS);
		this.riotQueue = new RiotRequestQueue(config.RIOT_SYNC_MIN_DELAY_MS);
		const riot = new RiotAccountService(config.RIOT_API_KEY, this.riotQueue, config.RIOT_SYNC_MAX_RETRIES, logger);
		const riotLeague = new RiotLeagueService(config.RIOT_API_KEY, this.riotQueue, config.RIOT_SYNC_MAX_RETRIES, logger);
		const champions = new ChampionCatalog(logger);
		const registrationService = new RegistrationService(registrations, new OpggParser(), riot, logger);
		const administrativeNicknameParser = new AdministrativeNicknameParser();
		const administrativeNicknameService = new AdministrativeNicknameService(config, registrations, riot, logger);
		const migrationService = new MigrationService(config, new LegacyNicknameParser(config.LEGACY_ALLOW_WHITESPACE_VARIATIONS), migrations, permissions, audits);
		const riotSync = new RiotSyncWorker(config, registrations, riot, leases, logger);
		const leagueStats = new LeagueStatsWorker(config, league, registrations, riotLeague, leases, logger);
		this.workers = [
			new DiscordAuditLogWorker(config, auditOutbox, new DiscordAuditPresenter(config, i18n), leases, logger),
			new DiscordOperationWorker(config, operations, this.discordQueue, reconciliation, leases, logger),
			new MigrationWorker(this.client, config, migrations, registrations, riot, leases, logger),
			new CleanupWorker(this.client, config, registrations, permissions, this.discordQueue, i18n, leases, audits, logger),
			riotSync,
			leagueStats,
			new RetentionWorker(registrations, audits, leases, logger),
		];
		const interactionContext = {
			client: this.client,
			config,
			i18n,
			logger,
			registrationService,
			registrations,
			reconciliation,
			permissions,
			migrationService,
			migrations,
			riotSync,
			league,
			leagueStats,
			champions,
			audits,
		};
		this.client.on(Events.InteractionCreate, (interaction) => void handleInteraction(interaction, interactionContext));
		this.client.on(Events.MessageCreate, createLeagueMentionHandler(interactionContext, logger));
		this.client.on(Events.GuildMemberAdd, createGuildMemberAddHandler(registrations, reconciliation, audits, logger, i18n, config.JOIN_ENGAGEMENT_ENABLED));
		this.client.on(Events.GuildMemberRemove, createGuildMemberRemoveHandler(registrations, audits, logger));
		this.client.on(
			Events.GuildMemberUpdate,
			createGuildMemberUpdateHandler(config, administrativeNicknameParser, nicknames, administrativeNicknameService, registrations, permissions, audits, logger)
		);
	}

	async start(): Promise<void> {
		await this.client.login(this.config.DISCORD_TOKEN);
		await new Promise<void>((resolve, reject) => {
			if (this.client.isReady()) return resolve();
			const timeout = setTimeout(() => reject(new Error("DISCORD_READY_TIMEOUT")), 30_000);
			this.client.once(Events.ClientReady, () => {
				clearTimeout(timeout);
				resolve();
			});
		});
		const guild = await this.client.guilds.fetch(this.config.DISCORD_GUILD_ID);
		await guild.roles.fetch();
		const diagnostics = await diagnoseGuild(this.client, guild, this.config, new Localizer(this.config.BOT_LOCALE, this.config.BOT_TIME_ZONE));
		for (const warning of diagnostics.warnings) this.logger.warn({ diagnostic: warning }, "Discord role diagnostic warning");
		if (diagnostics.errors.length) throw new Error(`Discord diagnostics failed:\n${diagnostics.errors.join("\n")}`);
		if (this.config.RANK_ROLE_SYNC_ENABLED) {
			const members = await guild.members.fetch();
			this.rankRoleSweep.run(guild.id, members);
		}
		await guild.commands.set(commandDefinitions(new Localizer(this.config.BOT_LOCALE, this.config.BOT_TIME_ZONE)).map((command) => command.toJSON()));
		this.client.user?.setPresence({
			status: "online",
			activities: [{ name: this.config.BOT_ACTIVITY_TEXT, type: ActivityType.Playing }],
		});
		if (!this.config.RIOT_API_KEY) this.logger.warn("Riot API key is missing; verification, Riot migration work, and Riot synchronization are paused");
		for (const worker of this.workers) worker.start();
		this.logger.info({ guildId: guild.id, userId: this.client.user?.id }, "Bot ready");
	}

	async stop(signal = "manual"): Promise<void> {
		if (this.stopping) return;
		this.stopping = true;
		this.logger.info({ signal }, "Graceful shutdown started");
		for (const worker of this.workers) worker.stop();
		this.discordQueue.stop();
		this.riotQueue.stop();
		this.client.destroy();
		this.database.sqlite.pragma("wal_checkpoint(TRUNCATE)");
		this.database.sqlite.close();
		this.logger.info("Graceful shutdown completed");
	}
}

function rankRoleIds(config: AppConfig): RankRoleIds {
	if (!config.RANK_ROLE_SYNC_ENABLED) return {};
	const tiers: RankRoleKey[] = ["UNRANKED", "IRON", "BRONZE", "SILVER", "GOLD", "PLATINUM", "EMERALD", "DIAMOND", "MASTER", "GRANDMASTER", "CHALLENGER"];
	return Object.fromEntries(tiers.map((tier) => [tier, config[`RANK_ROLE_${tier}_ID` as keyof AppConfig]])) as RankRoleIds;
}
