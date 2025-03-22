#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import * as mysql from "mysql2/promise";

// MySQL connection manager class
class MySQLConnectionManager {
  private connection: mysql.Connection | null = null;
  private config: mysql.ConnectionOptions = {};

  // Check connection status
  isConnected(): boolean {
    return this.connection !== null;
  }

  // Get current connection information
  getConnectionInfo(): any {
    if (!this.isConnected()) {
      return { connected: false };
    }

    return {
      connected: true,
      host: this.config.host || "unknown",
      port: this.config.port || 3306,
      user: this.config.user || "unknown",
      database: this.config.database || "none"
    };
  }

  // Connect to MySQL database
  async connect(config: mysql.ConnectionOptions): Promise<string> {
    try {
      // If already connected, disconnect first
      if (this.connection) {
        await this.disconnect();
      }

      this.config = config;
      this.connection = await mysql.createConnection(config);

      return `Successfully connected to ${config.host}:${
        config.port || 3306
      } database: ${config.database || "MySQL"}`;
    } catch (error: any) {
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
        return "Database connection has been closed";
      }
      return "No active database connection";
    } catch (error: any) {
      return `Disconnection failed: ${error.message}`;
    }
  }

  // Execute SQL query
  async executeQuery(sql: string, params: any[] = []): Promise<any> {
    if (!this.connection) {
      throw new Error(
        "Not connected to a database. Please use the 'connect' tool first."
      );
    }

    try {
      const [rows] = await this.connection.execute(sql, params);
      return rows;
    } catch (error: any) {
      throw new Error(`Query execution failed: ${error.message}`);
    }
  }

  // Change database
  async useDatabase(database: string): Promise<string> {
    if (!this.connection) {
      throw new Error(
        "Not connected to a database. Please use the 'connect' tool first."
      );
    }

    try {
      await this.connection.execute(`USE \`${database}\``);
      this.config.database = database;
      return `Database changed to '${database}'`;
    } catch (error: any) {
      throw new Error(`Failed to change database: ${error.message}`);
    }
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
      statusText = `Connection status: Connected\nHost: ${info.host}\nPort: ${info.port}\nUser: ${info.user}\nDatabase: ${info.database}`;
    } else {
      statusText =
        "Connection status: Not connected\nUse the 'connect' tool to connect to a database.";
    }

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

// Start server
async function main() {
  // Get default connection info from environment variables
  const defaultHost = process.env.MYSQL_HOST;
  const defaultUser = process.env.MYSQL_USER;
  const defaultPassword = process.env.MYSQL_PASSWORD;
  const defaultDatabase = process.env.MYSQL_DATABASE;

  // Attempt auto-connection if environment variables are available
  if (defaultHost && defaultUser !== undefined) {
    try {
      await dbManager.connect({
        host: defaultHost,
        port: parseInt(process.env.MYSQL_PORT || "3306", 10),
        user: defaultUser,
        password: defaultPassword || "",
        database: defaultDatabase
      });
      console.error(`Automatically connected to MySQL(${defaultHost})`);
    } catch (error) {
      console.error("Auto-connection failed:", error);
    }
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("MySQL MCP Server running on stdio");
}

main().catch((error) => {
  console.error("Fatal error in main():", error);
  process.exit(1);
});
