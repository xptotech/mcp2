import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema
} from "@modelcontextprotocol/sdk/types.js";
import { createConnection, Connection, RowDataPacket } from "mysql2/promise";

// Set up logging
const logger = {
  info: (message: string) => console.log(`[INFO] ${message}`),
  error: (message: string) => console.error(`[ERROR] ${message}`),
  debug: (message: string) => console.debug(`[DEBUG] ${message}`)
};



// Global connection state
let connection: Connection | null = null;
let connectionConfig = {
  host: process.env.MYSQL_HOST || "localhost",
  port: parseInt(process.env.MYSQL_PORT || "3306", 10),
  user: process.env.MYSQL_USER || "root",
  password: process.env.MYSQL_PASSWORD || "",
  database: process.env.MYSQL_DATABASE || ""
};

// Initialize MCP server
const server = new Server(
  {
    name: "mysql-mcp",
    version: "0.1.0"
  },
  {
    capabilities: {
      tools: {}
    }
  }
);

// Helper function to get current connection or throw error if not connected
async function getConnection(): Promise<Connection> {
  if (!connection) {
    throw new Error("Database not connected. Use 'connect' tool first.");
  }
  return connection;
}

// Connect to MySQL with current config
async function connectToDatabase(
  config = connectionConfig
): Promise<Connection> {
  try {
    if (connection) {
      logger.info("Closing existing connection before creating a new one");
      await connection.end();
    }

    connection = await createConnection({
      host: config.host,
      port: config.port,
      user: config.user,
      password: config.password,
      database: config.database,
      multipleStatements: true // Allow multiple statements in one query
    });

    connectionConfig = config;
    logger.info(`Connected to MySQL database at ${config.host}:${config.port}`);
    return connection;
  } catch (error) {
    logger.error(`Failed to connect to database: ${error}`);
    throw error;
  }
}

// Define available tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "status",
        description: "Check the current database connection status.",
        inputSchema: {
          type: "object",
          properties: {}
        }
      },
      {
        name: "connect",
        description: "Connect to a MySQL database.",
        inputSchema: {
          type: "object",
          properties: {
            host: {
              type: "string",
              description: "Database server hostname or IP address"
            },
            port: { type: "string", description: "Database server port" },
            user: { type: "string", description: "Database username" },
            password: { type: "string", description: "Database password" },
            database: {
              type: "string",
              description: "Database name to connect to"
            }
          }
        }
      },
      {
        name: "disconnect",
        description: "Close the current MySQL database connection.",
        inputSchema: {
          type: "object",
          properties: {}
        }
      },
      {
        name: "query",
        description: "Execute an SQL query on the connected database.",
        inputSchema: {
          type: "object",
          properties: {
            sql: { type: "string", description: "SQL query to execute" },
            params: {
              type: "array",
              description: "Parameters for prepared statements",
              items: { type: "string" }
            }
          },
          required: ["sql"]
        }
      },
      {
        name: "list_tables",
        description: "Get a list of tables in the current database.",
        inputSchema: {
          type: "object",
          properties: {}
        }
      },
      {
        name: "describe_table",
        description: "Get the structure of a specific table.",
        inputSchema: {
          type: "object",
          properties: {
            table: {
              type: "string",
              description: "Name of the table to describe"
            }
          },
          required: ["table"]
        }
      },
      {
        name: "list_databases",
        description: "Get a list of all accessible databases on the server.",
        inputSchema: {
          type: "object",
          properties: {}
        }
      },
      {
        name: "use_database",
        description: "Switch to a different database.",
        inputSchema: {
          type: "object",
          properties: {
            database: {
              type: "string",
              description: "Name of the database to switch to"
            }
          },
          required: ["database"]
        }
      }
    ]
  };
});

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  try {
    switch (request.params.name) {
      case "status": {
        if (!connection) {
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  {
                    connected: false,
                    message: "Database not connected. Need to use 'connect' tool after checking current environment variable information",
                    host: process.env.MYSQL_HOST || "localhost",
                    port: parseInt(process.env.MYSQL_PORT || "3306", 10),
                    user: process.env.MYSQL_USER || "root",
                    database: process.env.MYSQL_DATABASE || ""
                  },
                  null,
                  2
                )
              }
            ],
            isError: false
          };
        }

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  connected: true,
                  host: connectionConfig.host,
                  port: connectionConfig.port,
                  user: connectionConfig.user,
                  database: connectionConfig.database,
                  threadId: connection.threadId
                },
                null,
                2
              )
            }
          ],
          isError: false
        };
      }

      case "connect": {
        const args = request.params.arguments || {};
        const newConfig = {
          host: (args.host as string) || connectionConfig.host,
          port: parseInt(
            (args.port as string) || connectionConfig.port.toString()
          ),
          user: (args.user as string) || connectionConfig.user,
          password: (args.password as string) || connectionConfig.password,
          database: (args.database as string) || connectionConfig.database
        };

        await connectToDatabase(newConfig);

        return {
          content: [
            {
              type: "text",
              text: `Successfully connected to MySQL at ${newConfig.host}:${newConfig.port}, database: ${newConfig.database}`
            }
          ],
          isError: false
        };
      }

      case "disconnect": {
        if (!connection) {
          return {
            content: [{ type: "text", text: "Not connected to any database" }],
            isError: false
          };
        }

        await connection.end();
        connection = null;

        return {
          content: [
            { type: "text", text: "Successfully disconnected from database" }
          ],
          isError: false
        };
      }

      case "query": {
        const conn = await getConnection();
        const sql = request.params.arguments?.sql as string;
        const params = (request.params.arguments?.params as any[]) || [];

        // Execute the query
        const [rows] = await conn.query(sql, params);

        return {
          content: [{ type: "text", text: JSON.stringify(rows, null, 2) }],
          isError: false
        };
      }

      case "list_tables": {
        const conn = await getConnection();

        const [rows] = await conn.query("SHOW TABLES");

        return {
          content: [{ type: "text", text: JSON.stringify(rows, null, 2) }],
          isError: false
        };
      }

      case "describe_table": {
        const conn = await getConnection();
        const tableName = request.params.arguments?.table as string;

        if (!tableName) {
          return {
            content: [{ type: "text", text: "Table name is required" }],
            isError: true
          };
        }

        const [rows] = await conn.query("DESCRIBE ??", [tableName]);

        return {
          content: [{ type: "text", text: JSON.stringify(rows, null, 2) }],
          isError: false
        };
      }

      case "list_databases": {
        const conn = await getConnection();

        const [rows] = await conn.query("SHOW DATABASES");

        return {
          content: [{ type: "text", text: JSON.stringify(rows, null, 2) }],
          isError: false
        };
      }

      case "use_database": {
        const conn = await getConnection();
        const dbName = request.params.arguments?.database as string;

        if (!dbName) {
          return {
            content: [{ type: "text", text: "Database name is required" }],
            isError: true
          };
        }

        await conn.query("USE ??", [dbName]);
        connectionConfig.database = dbName;

        return {
          content: [
            {
              type: "text",
              text: `Successfully switched to database: ${dbName}`
            }
          ],
          isError: false
        };
      }

      default:
        throw new Error(`Unknown tool: ${request.params.name}`);
    }
  } catch (error) {
    logger.error(`Error handling request: ${error}`);
    return {
      content: [
        {
          type: "text",
          text:
            error instanceof Error ? error.message : "Unknown error occurred"
        }
      ],
      isError: true
    };
  }
});

async function main() {
  logger.info("Starting MySQL MCP server...");
  const transport = new StdioServerTransport();
  await server.connect(transport);
  logger.info("Server connected to transport");

  // 데이터베이스 연결 추가
}

// Handle termination signals
process.once("SIGTERM", () => {
  logger.info("SIGTERM received, closing server");

  // Close database connection if open
  if (connection) {
    connection.end().catch((err) => {
      logger.error(`Error closing database connection: ${err}`);
    });
  }

  server.close().then(() => {
    logger.info("Server closed, exiting");
    process.exit(0);
  });
});

process.once("SIGINT", () => {
  logger.info("SIGINT received, closing server");

  // Close database connection if open
  if (connection) {
    connection.end().catch((err) => {
      logger.error(`Error closing database connection: ${err}`);
    });
  }

  server.close().then(() => {
    logger.info("Server closed, exiting");
    process.exit(0);
  });
});

main().catch((error) => {
  logger.error(
    error instanceof Error ? error.message : "Unknown error occurred"
  );
  process.exit(1);
});
