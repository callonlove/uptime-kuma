const { describe, test } = require("node:test");
const assert = require("node:assert");
const { OracleMonitorType } = require("../../../server/monitor-types/oracle");
const { UP, PENDING } = require("../../../src/util");

describe("Oracle Monitor", () => {
    test("parseConnectionString() parses oracle URL format", () => {
        const oracleMonitor = new OracleMonitorType();
        const result = oracleMonitor.parseConnectionString("oracle://user:pass@example.com:1521/XEPDB1");

        assert.deepStrictEqual(result, {
            user: "user",
            password: "pass",
            connectString: "example.com:1521/XEPDB1",
        });
    });

    test("parseConnectionString() parses user/password@connectString format", () => {
        const oracleMonitor = new OracleMonitorType();
        const result = oracleMonitor.parseConnectionString("user/pass@example.com:1521/XEPDB1");

        assert.deepStrictEqual(result, {
            user: "user",
            password: "pass",
            connectString: "example.com:1521/XEPDB1",
        });
    });

    test("check() sets status to UP when Oracle query succeeds", async () => {
        const oracleMonitor = new OracleMonitorType();
        oracleMonitor.oracleQuery = async () => "Rows: 1";

        const monitor = {
            databaseConnectionString: "oracle://user:pass@example.com:1521/XEPDB1",
            conditions: "[]",
        };

        const heartbeat = {
            msg: "",
            status: PENDING,
        };

        await oracleMonitor.check(monitor, heartbeat, {});
        assert.strictEqual(heartbeat.status, UP, `Expected status ${UP} but got ${heartbeat.status}`);
        assert.strictEqual(heartbeat.msg, "Rows: 1");
    });

    test("check() sets status to UP when query result meets condition", async () => {
        const oracleMonitor = new OracleMonitorType();
        oracleMonitor.oracleQuerySingleValue = async () => 42;

        const monitor = {
            databaseConnectionString: "oracle://user:pass@example.com:1521/XEPDB1",
            databaseQuery: "SELECT 42 AS value FROM DUAL",
            conditions: JSON.stringify([
                {
                    type: "expression",
                    andOr: "and",
                    variable: "result",
                    operator: "equals",
                    value: "42",
                },
            ]),
        };

        const heartbeat = {
            msg: "",
            status: PENDING,
        };

        await oracleMonitor.check(monitor, heartbeat, {});
        assert.strictEqual(heartbeat.status, UP, `Expected status ${UP} but got ${heartbeat.status}`);
        assert.strictEqual(heartbeat.msg, "Query did meet specified conditions");
    });

    test("check() rejects when query result does not meet condition", async () => {
        const oracleMonitor = new OracleMonitorType();
        oracleMonitor.oracleQuerySingleValue = async () => 99;

        const monitor = {
            databaseConnectionString: "oracle://user:pass@example.com:1521/XEPDB1",
            databaseQuery: "SELECT 99 AS value FROM DUAL",
            conditions: JSON.stringify([
                {
                    type: "expression",
                    andOr: "and",
                    variable: "result",
                    operator: "equals",
                    value: "42",
                },
            ]),
        };

        const heartbeat = {
            msg: "",
            status: PENDING,
        };

        await assert.rejects(
            oracleMonitor.check(monitor, heartbeat, {}),
            new Error("Query result did not meet the specified conditions (99)")
        );
        assert.strictEqual(heartbeat.status, PENDING, `Expected status should not be ${heartbeat.status}`);
    });

    test("check() rejects with installation hint when oracledb is missing", async () => {
        const oracleMonitor = new OracleMonitorType();
        oracleMonitor.loadOracleDB = () => {
            throw new Error("Oracle monitor requires optional dependency 'oracledb'. Please run: npm install oracledb");
        };

        const monitor = {
            databaseConnectionString: "oracle://user:pass@example.com:1521/XEPDB1",
            conditions: "[]",
        };

        const heartbeat = {
            msg: "",
            status: PENDING,
        };

        await assert.rejects(
            oracleMonitor.check(monitor, heartbeat, {}),
            new Error(
                "Database connection/query failed: Oracle monitor requires optional dependency 'oracledb'. Please run: npm install oracledb"
            )
        );
        assert.notStrictEqual(heartbeat.status, UP, `Expected status should not be ${UP}`);
    });
});
