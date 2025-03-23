#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import * as mysql from "mysql2/promise";
import * as dotenv from "dotenv";

// 환경 변수 로드
dotenv.config();

// 디버깅용 로그 함수
function logDebug(message: string, data?: any) {
  console.error(`[DEBUG] ${message}`, data ? JSON.stringify(data) : "");
}

// 초기 환경 변수 로깅
logDebug("Initial Environment Variables:", {
  MYSQL_HOST: process.env.MYSQL_HOST,
  MYSQL_PORT: process.env.MYSQL_PORT,
  MYSQL_USER: process.env.MYSQL_USER,
  MYSQL_DATABASE: process.env.MYSQL_DATABASE,
  MYSQL_READONLY: process.env.MYSQL_READONLY
});

// Query type enum for categorizing SQL operations
enum QueryType {
  SELECT = "SELECT",
  INSERT = "INSERT",
  UPDATE = "UPDATE",
  DELETE = "DELETE",
  CREATE = "CREATE",
  DROP = "DROP",
  ALTER = "ALTER",
  TRUNCATE = "TRUNCATE",
  USE = "USE",
  SHOW = "SHOW",
  DESCRIBE = "DESCRIBE",
  UNKNOWN = "UNKNOWN"
}

// Determine if query type is a write operation
function isWriteOperation(queryType: QueryType): boolean {
  const writeOperations = [
    QueryType.INSERT,
    QueryType.UPDATE,
    QueryType.DELETE,
    QueryType.CREATE,
    QueryType.DROP,
    QueryType.ALTER,
    QueryType.TRUNCATE
  ];
  return writeOperations.includes(queryType);
}

// Get query type from SQL query
function getQueryType(query: string): QueryType {
  const firstWord = query.trim().split(/\s+/)[0].toUpperCase();
  return Object.values(QueryType).includes(firstWord as QueryType)
    ? (firstWord as QueryType)
    : QueryType.UNKNOWN;
}

// MySQL connection manager class
class MySQLConnectionManager {
  private connection: mysql.Connection | null = null;
  private config: mysql.ConnectionOptions = {};
  private readonly: boolean = false;

  constructor() {
    // Read config from environment variables
    this.loadConfigFromEnv();
  }

  // Load configuration from environment variables
  private loadConfigFromEnv(): void {
    this.config = {
      host: process.env.MYSQL_HOST || "localhost",
      port: parseInt(process.env.MYSQL_PORT || "3306", 10),
      user: process.env.MYSQL_USER || "root",
      password: process.env.MYSQL_PASSWORD || "",
      database: process.env.MYSQL_DATABASE || undefined
    };

    // Set readonly mode
    this.readonly =
      (process.env.MYSQL_READONLY || "false").toLowerCase() === "true";

    logDebug("Config loaded from env:", {
      host: this.config.host,
      port: this.config.port,
      user: this.config.user,
      database: this.config.database || "none",
      readonly: this.readonly
    });
  }

  // Check connection status
  isConnected(): boolean {
    return this.connection !== null;
  }

  // Get current connection information
  getConnectionInfo(): any {
    if (!this.isConnected()) {
      return {
        connected: false,
        readonly: this.readonly
      };
    }

    return {
      connected: true,
      host: this.config.host || "unknown",
      port: this.config.port || 3306,
      user: this.config.user || "unknown",
      database: this.config.database || "none",
      readonly: this.readonly
    };
  }

  // Ensure connection is established
  private async ensureConnected(): Promise<void> {
    if (!this.connection) {
      try {
        logDebug("Attempting to connect with:", this.config);
        this.connection = await mysql.createConnection(this.config);
        logDebug(`Connected to MySQL: ${this.config.host}:${this.config.port}`);
      } catch (error: any) {
        logDebug(`Connection error:`, error);
        throw new Error(`Database connection failed: ${error.message}`);
      }
    }
  }

  // Connect to MySQL database
  async connect(config: mysql.ConnectionOptions): Promise<string> {
    try {
      // If already connected, disconnect first
      if (this.connection) {
        await this.disconnect();
      }

      this.config = { ...config };
      logDebug("Connecting with config:", this.config);
      await this.ensureConnected();

      return `Successfully connected to ${config.host}:${
        config.port || 3306
      } database: ${config.database || "MySQL"}`;
    } catch (error: any) {
      logDebug("Connection failed:", error);
      return `Database connection failed: ${error.message}`;
    }
  }

  // Disconnect from the database
  async disconnect(): Promise<string> {
    try {
      if (this.connection) {
        await this.connection.end();
        this.connection = null;
        this.config = {};
        this.loadConfigFromEnv(); // Reload config from env after disconnect
        return "Database connection has been closed";
      }
      return "No active database connection";
    } catch (error: any) {
      return `Disconnection failed: ${error.message}`;
    }
  }

  // Execute SQL query
  async executeQuery(sql: string, params: any[] = []): Promise<any> {
    // Validate read-only constraints
    const queryType = getQueryType(sql);
    if (this.readonly && isWriteOperation(queryType)) {
      throw new Error(
        "Server is in read-only mode. Write operations are not allowed."
      );
    }

    // Handle special case for USE statements
    if (queryType === QueryType.USE) {
      return this.useDatabase(sql.trim().split(/\s+/)[1].replace(/[`'"]/g, ""));
    }

    // Ensure connection is established
    await this.ensureConnected();

    if (!this.connection) {
      throw new Error(
        "Not connected to a database. Please use the 'connect' tool first."
      );
    }

    try {
      logDebug(`Executing query: ${sql}`, params);
      const [rows] = await this.connection.execute(sql, params);

      // Format dates and special values if needed
      return this.formatQueryResults(rows);
    } catch (error: any) {
      logDebug("Query execution failed:", error);
      throw new Error(`Query execution failed: ${error.message}`);
    }
  }

  // Format query results for better readability
  private formatQueryResults(rows: any): any {
    if (Array.isArray(rows)) {
      return rows.map((row) => {
        const formattedRow: any = {};
        for (const [key, value] of Object.entries(row)) {
          // Format Date objects to ISO string
          if (value instanceof Date) {
            formattedRow[key] = (value as Date).toISOString();
          } else {
            formattedRow[key] = value;
          }
        }
        return formattedRow;
      });
    }
    return rows;
  }

  // Change database
  async useDatabase(database: string): Promise<string> {
    // Ensure connection is established
    await this.ensureConnected();

    if (!this.connection) {
      throw new Error(
        "Not connected to a database. Please use the 'connect' tool first."
      );
    }

    try {
      await this.connection.execute(`USE \`${database}\``);
      this.config.database = database;
      logDebug(`Database changed to: ${database}`);
      return `Database changed to '${database}'`;
    } catch (error: any) {
      logDebug("Failed to change database:", error);
      throw new Error(`Failed to change database: ${error.message}`);
    }
  }

  // Set readonly mode
  setReadonlyMode(readonly: boolean): void {
    this.readonly = readonly;
    logDebug(`Read-only mode set to: ${readonly}`);
  }

  // Get readonly status
  isReadonly(): boolean {
    return this.readonly;
  }
}

// Create server instance
const server = new McpServer({
  name: "mysql",
  version: "1.0.0"
});

// Create MySQL connection manager instance
const dbManager = new MySQLConnectionManager();

// Register status tool
server.tool(
  "status",
  "Check current database connection status",
  {},
  async () => {
    const info = dbManager.getConnectionInfo();
    let statusText = "";

    if (info.connected) {
      statusText = `Connection status: Connected\nHost: ${info.host}\nPort: ${
        info.port
      }\nUser: ${info.user}\nDatabase: ${info.database}\nRead-only mode: ${
        info.readonly ? "Enabled" : "Disabled"
      }`;
    } else {
      statusText = `Connection status: Not connected\nUse the 'connect' tool to connect to a database.\nRead-only mode: ${
        info.readonly ? "Enabled" : "Disabled"
      }`;
    }

    logDebug("Status requested:", info);

    return {
      content: [
        {
          type: "text",
          text: statusText
        }
      ]
    };
  }
);

// Register connect tool
server.tool(
  "connect",
  "Connect to a MySQL database",
  {
    host: z
      .string()
      .default("localhost")
      .describe("Database server hostname or IP address"),
    port: z.string().default("3306").describe("Database server port"),
    user: z.string().default("root").describe("Database username"),
    password: z.string().default("").describe("Database password"),
    database: z
      .string()
      .optional()
      .describe("Database name to connect to (optional)")
  },
  async ({ host, port, user, password, database }) => {
    logDebug("Connect tool called with:", { host, port, user, database });

    const result = await dbManager.connect({
      host,
      port: parseInt(port, 10),
      user,
      password,
      database
    });

    return {
      content: [
        {
          type: "text",
          text: result
        }
      ]
    };
  }
);

// Register disconnect tool
server.tool(
  "disconnect",
  "Close the current MySQL database connection",
  {},
  async () => {
    const result = await dbManager.disconnect();

    return {
      content: [
        {
          type: "text",
          text: result
        }
      ]
    };
  }
);

// Register query tool
server.tool(
  "query",
  "Execute an SQL query on the connected database",
  {
    sql: z.string().describe("SQL query to execute"),
    params: z
      .array(z.any())
      .optional()
      .describe("Parameters for prepared statements (optional)")
  },
  async ({ sql, params = [] }) => {
    try {
      const results = await dbManager.executeQuery(sql, params);

      return {
        content: [
          {
            type: "text",
            text: `Query results:\n${JSON.stringify(results, null, 2)}`
          }
        ]
      };
    } catch (error: any) {
      return {
        content: [
          {
            type: "text",
            text: error.message
          }
        ]
      };
    }
  }
);

// Register list_tables tool
server.tool(
  "list_tables",
  "Get a list of tables in the current database",
  {},
  async () => {
    try {
      const tables = await dbManager.executeQuery("SHOW TABLES");

      if (tables.length === 0) {
        return {
          content: [
            {
              type: "text",
              text: "No tables found in the current database"
            }
          ]
        };
      }

      const tableNames = tables
        .map((row: any) => Object.values(row)[0])
        .join("\n");

      return {
        content: [
          {
            type: "text",
            text: `Tables list:\n${tableNames}`
          }
        ]
      };
    } catch (error: any) {
      return {
        content: [
          {
            type: "text",
            text: error.message
          }
        ]
      };
    }
  }
);

// Register describe_table tool
server.tool(
  "describe_table",
  "Get the structure of a specific table",
  {
    table: z.string().describe("Name of the table to describe")
  },
  async ({ table }) => {
    try {
      const structure = await dbManager.executeQuery(`DESCRIBE \`${table}\``);

      return {
        content: [
          {
            type: "text",
            text: `'${table}' table structure:\n${JSON.stringify(
              structure,
              null,
              2
            )}`
          }
        ]
      };
    } catch (error: any) {
      return {
        content: [
          {
            type: "text",
            text: error.message
          }
        ]
      };
    }
  }
);

// Register list_databases tool
server.tool(
  "list_databases",
  "Get a list of all accessible databases on the server",
  {},
  async () => {
    try {
      const databases = await dbManager.executeQuery("SHOW DATABASES");

      const dbNames = databases.map((row: any) => row.Database).join("\n");

      return {
        content: [
          {
            type: "text",
            text: `Databases list:\n${dbNames}`
          }
        ]
      };
    } catch (error: any) {
      return {
        content: [
          {
            type: "text",
            text: error.message
          }
        ]
      };
    }
  }
);

// Register use_database tool
server.tool(
  "use_database",
  "Switch to a different database",
  {
    database: z.string().describe("Name of the database to switch to")
  },
  async ({ database }) => {
    try {
      const result = await dbManager.useDatabase(database);

      return {
        content: [
          {
            type: "text",
            text: result
          }
        ]
      };
    } catch (error: any) {
      return {
        content: [
          {
            type: "text",
            text: error.message
          }
        ]
      };
    }
  }
);

// Register set_readonly tool
server.tool(
  "set_readonly",
  "Enable or disable read-only mode",
  {
    readonly: z
      .boolean()
      .describe("Set to true to enable read-only mode, false to disable")
  },
  async ({ readonly }) => {
    dbManager.setReadonlyMode(readonly);

    return {
      content: [
        {
          type: "text",
          text: `Read-only mode ${readonly ? "enabled" : "disabled"}`
        }
      ]
    };
  }
);

// 환경 변수 처리 함수 - 다양한 소스에서 환경 변수를 로드
function loadEnvironmentVariables() {
  // 1. .env 파일 로드 (이미 위에서 dotenv.config()로 로드됨)

  // 2. 커맨드라인 인자를 통한 설정
  const args = process.argv.slice(2);
  let configIndex = args.indexOf("--config");
  if (configIndex !== -1 && args.length > configIndex + 1) {
    try {
      const config = JSON.parse(args[configIndex + 1]);
      for (const [key, value] of Object.entries(config)) {
        process.env[key] = String(value);
        logDebug(`Setting env from CLI args: ${key}=${value}`);
      }
    } catch (error) {
      logDebug("Failed to parse config argument:", error);
    }
  }

  // 3. 직접 환경 변수 디버깅
  logDebug("Final Environment Variables:", {
    MYSQL_HOST: process.env.MYSQL_HOST,
    MYSQL_PORT: process.env.MYSQL_PORT,
    MYSQL_USER: process.env.MYSQL_USER,
    MYSQL_PASSWORD: process.env.MYSQL_PASSWORD ? "[REDACTED]" : undefined,
    MYSQL_DATABASE: process.env.MYSQL_DATABASE,
    MYSQL_READONLY: process.env.MYSQL_READONLY
  });
}

// Start server
async function main() {
  // 환경 변수 처리
  loadEnvironmentVariables();

  // Get default connection info from environment variables
  const defaultHost = process.env.MYSQL_HOST;
  const defaultUser = process.env.MYSQL_USER;
  const defaultPassword = process.env.MYSQL_PASSWORD;
  const defaultDatabase = process.env.MYSQL_DATABASE;
  const defaultPort = process.env.MYSQL_PORT || "3306";
  const defaultReadonly =
    (process.env.MYSQL_READONLY || "false").toLowerCase() === "true";

  logDebug("Using connection params:", {
    host: defaultHost,
    port: defaultPort,
    user: defaultUser,
    database: defaultDatabase || "none",
    readonly: defaultReadonly
  });

  // Set readonly mode
  dbManager.setReadonlyMode(defaultReadonly);

  // Attempt auto-connection if environment variables are available
  if (defaultHost && defaultUser !== undefined) {
    try {
      logDebug("Attempting auto-connection...");
      await dbManager.connect({
        host: defaultHost,
        port: parseInt(defaultPort, 10),
        user: defaultUser,
        password: defaultPassword || "",
        database: defaultDatabase
      });
      logDebug(`Automatically connected to MySQL(${defaultHost})`);
    } catch (error) {
      logDebug("Auto-connection failed:", error);
    }
  } else {
    logDebug("Skipping auto-connection - missing required env variables");
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);
  logDebug("MySQL MCP Server running on stdio");
}

main().catch((error) => {
  logDebug("Fatal error in main():", error);
  process.exit(1);
});
