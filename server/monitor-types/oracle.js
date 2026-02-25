const { MonitorType } = require("./monitor-type");
const { log, UP } = require("../../src/util");
const dayjs = require("dayjs");
const { ConditionVariable } = require("../monitor-conditions/variables");
const { defaultStringOperators } = require("../monitor-conditions/operators");
const { ConditionExpressionGroup } = require("../monitor-conditions/expression");
const { evaluateExpressionGroup } = require("../monitor-conditions/evaluator");

class OracleMonitorType extends MonitorType {
    name = "oracle";

    supportsConditions = true;
    conditionVariables = [new ConditionVariable("result", defaultStringOperators)];

    /**
     * @inheritdoc
     */
    async check(monitor, heartbeat, _server) {
        let query = monitor.databaseQuery;
        if (!query || (typeof query === "string" && query.trim() === "")) {
            query = "SELECT 1 FROM DUAL";
        }

        const conditions = monitor.conditions ? ConditionExpressionGroup.fromMonitor(monitor) : null;
        const hasConditions = conditions && conditions.children && conditions.children.length > 0;

        const startTime = dayjs().valueOf();
        try {
            if (hasConditions) {
                const result = await this.oracleQuerySingleValue(monitor.databaseConnectionString, query);
                heartbeat.ping = dayjs().valueOf() - startTime;

                const conditionsResult = evaluateExpressionGroup(conditions, { result: String(result) });

                if (!conditionsResult) {
                    throw new Error(`Query result did not meet the specified conditions (${result})`);
                }

                heartbeat.status = UP;
                heartbeat.msg = "Query did meet specified conditions";
            } else {
                const result = await this.oracleQuery(monitor.databaseConnectionString, query);
                heartbeat.ping = dayjs().valueOf() - startTime;
                heartbeat.status = UP;
                heartbeat.msg = result;
            }
        } catch (error) {
            heartbeat.ping = dayjs().valueOf() - startTime;
            if (error.message.includes("did not meet the specified conditions")) {
                throw error;
            }
            throw new Error(`Database connection/query failed: ${error.message}`);
        }
    }

    /**
     * Load node-oracledb at runtime so existing installs without this optional dependency still boot.
     * @returns {import("oracledb")} Loaded node-oracledb module.
     * @throws {Error} Dependency is missing or driver import failed.
     */
    loadOracleDB() {
        try {
            return require("oracledb");
        } catch (error) {
            if (error && error.code === "MODULE_NOT_FOUND") {
                throw new Error("Oracle monitor requires optional dependency 'oracledb'. Please run: npm install oracledb");
            }

            throw error;
        }
    }

    /**
     * Parse Oracle connection string to node-oracledb connection config.
     * Supports:
     * - oracle://user:password@host:port/service_name
     * - user/password@host:port/service_name
     * @param {string} connectionString Oracle connection string
     * @returns {{user: string, password: string, connectString: string}} connection config
     * @throws {Error} Connection string is empty or malformed.
     */
    parseConnectionString(connectionString) {
        const value = (connectionString || "").trim();

        if (!value) {
            throw new Error("Connection string is empty");
        }

        if (value.startsWith("oracle://")) {
            const parsed = new URL(value);
            const host = parsed.hostname;
            const port = parsed.port ? `:${parsed.port}` : "";
            const serviceName = parsed.pathname.replace(/^\/+/, "") || parsed.searchParams.get("service_name");

            const user = decodeURIComponent(parsed.username || "");
            const password = decodeURIComponent(parsed.password || "");

            if (!host) {
                throw new Error("Oracle connection string is missing hostname");
            }

            if (!user) {
                throw new Error("Oracle connection string is missing username");
            }

            if (!password) {
                throw new Error("Oracle connection string is missing password");
            }

            if (!serviceName) {
                throw new Error("Oracle connection string is missing service name");
            }

            return {
                user,
                password,
                connectString: `${host}${port}/${serviceName}`,
            };
        }

        const match = value.match(/^([^/]+)\/([^@]*)@(.+)$/);
        if (match) {
            const user = match[1];
            const password = match[2];
            const connectString = match[3];

            if (!user || !password || !connectString) {
                throw new Error("Invalid Oracle connection string");
            }

            return { user, password, connectString };
        }

        throw new Error(
            "Unsupported Oracle connection string format. Use oracle://user:password@host:port/service_name or user/password@host:port/service_name"
        );
    }

    /**
     * Run a query on Oracle (backwards compatible - returns row count)
     * @param {string} connectionString The database connection string
     * @param {string} query The query to execute
     * @returns {Promise<string>} Row count message
     */
    async oracleQuery(connectionString, query) {
        const oracledb = this.loadOracleDB();
        let connection;

        try {
            connection = await oracledb.getConnection(this.parseConnectionString(connectionString));
            const result = await connection.execute(query, [], {
                outFormat: oracledb.OUT_FORMAT_OBJECT,
            });

            if (Array.isArray(result.rows)) {
                return "Rows: " + result.rows.length;
            }

            if (typeof result.rowsAffected === "number") {
                return "Rows Affected: " + result.rowsAffected;
            }

            return "No Error, but the result is not an array. Type: " + typeof result.rows;
        } catch (error) {
            log.debug("oracle", "Error caught in the query execution.", error.message);
            throw error;
        } finally {
            if (connection) {
                await connection.close();
            }
        }
    }

    /**
     * Run a query on Oracle expecting a single value result
     * @param {string} connectionString The database connection string
     * @param {string} query The query to execute
     * @returns {Promise<any>} Single value from the first column of the first row
     */
    async oracleQuerySingleValue(connectionString, query) {
        const oracledb = this.loadOracleDB();
        let connection;

        try {
            connection = await oracledb.getConnection(this.parseConnectionString(connectionString));
            const result = await connection.execute(query, [], {
                outFormat: oracledb.OUT_FORMAT_OBJECT,
            });

            if (!Array.isArray(result.rows) || result.rows.length === 0) {
                throw new Error("Query returned no results");
            }

            if (result.rows.length > 1) {
                throw new Error("Multiple values were found, expected only one value");
            }

            const firstRow = result.rows[0];
            const columnNames = Object.keys(firstRow);

            if (columnNames.length > 1) {
                throw new Error("Multiple columns were found, expected only one value");
            }

            return firstRow[columnNames[0]];
        } catch (error) {
            log.debug("oracle", "Error caught in the query execution.", error.message);
            throw error;
        } finally {
            if (connection) {
                await connection.close();
            }
        }
    }
}

module.exports = {
    OracleMonitorType,
};
