import { applyE2EDatabaseEnv } from "../../src/shared/db/e2e-database-guard";

/**
 * Импортировать первой строкой во всём, что запускается для e2e: подставляет базу из `.env.e2e`
 * до загрузки клиента базы и останавливает запуск, если адресов нет или база не та.
 */
applyE2EDatabaseEnv();
