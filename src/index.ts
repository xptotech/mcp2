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

// Global connection state
let connection: Connection | null = null;
let connectionConfig = {
  host: process.env.MYSQL_HOST || "localhost",
  port: parseInt(process.env.MYSQL_PORT || "3306", 10),
  user: process.env.MYSQL_USER || "root",
  password: process.env.MYSQL_PASSWORD || "",
  database: process.env.MYSQL_DATABASE || "",
  readonly: process.env.MYSQL_READONLY === "true" || false
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
    throw new Error(
      "Database not connected. Please use the 'connect' tool first."
    );
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

// Validate query against readonly mode
async function executeQuery(sql: string, params: any[] = []): Promise<any> {
  const conn = await getConnection();

  // Check if in readonly mode and validate query type
  if (connectionConfig.readonly) {
    const queryType = getQueryType(sql);
    if (isWriteOperation(queryType)) {
      throw new Error(
        "Server is in read-only mode. Write operations are not allowed."
      );
    }
  }

  // Execute the query
  const [rows] = await conn.query(sql, params);
  return rows;
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
          properties: {
            random_string: {
              type: "string",
              description: "Dummy parameter for no-parameter tools"
            }
          },
          required: ["random_string"]
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
          properties: {
            random_string: {
              type: "string",
              description: "Dummy parameter for no-parameter tools"
            }
          },
          required: ["random_string"]
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
          properties: {
            random_string: {
              type: "string",
              description: "Dummy parameter for no-parameter tools"
            }
          },
          required: ["random_string"]
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
          properties: {
            random_string: {
              type: "string",
              description: "Dummy parameter for no-parameter tools"
            }
          },
          required: ["random_string"]
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
      },
      {
        name: "set_readonly",
        description: "Enable or disable read-only mode",
        inputSchema: {
          type: "object",
          properties: {
            readonly: {
              type: "boolean",
              description:
                "Set to true to enable read-only mode, false to disable"
            }
          },
          required: ["readonly"]
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
                    message:
                      "Database not connected. Need to use 'connect' tool after checking current environment variable information. The password is sensitive information and is stored in an environment variable, so it is not required in the request parameters.",
                    host: connectionConfig.host,
                    port: connectionConfig.port,
                    user: connectionConfig.user,
                    database: connectionConfig.database,
                    readonly: connectionConfig.readonly
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
                  threadId: connection.threadId,
                  readonly: connectionConfig.readonly
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
          database: (args.database as string) || connectionConfig.database,
          readonly: connectionConfig.readonly // Maintain existing readonly setting
        };

        try {
          await connectToDatabase(newConfig);
        } catch (error) {
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  {
                    connected: false,
                    message:
                      "Database connection failed, please request with new information or check the environment variable information."
                  },
                  null,
                  2
                )
              }
            ],
            isError: true
          };
        }

        return {
          content: [
            {
              type: "text",
              text: `Successfully connected to MySQL at ${newConfig.host}:${
                newConfig.port
              }, database: ${newConfig.database}, read-only mode: ${
                newConfig.readonly ? "enabled" : "disabled"
              }`
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
            {
              type: "text",
              text: "Successfully disconnected from database"
            }
          ],
          isError: false
        };
      }

      case "query": {
        try {
          const sql = request.params.arguments?.sql as string;
          const params = (request.params.arguments?.params as any[]) || [];

          // Execute query with validation
          const rows = await executeQuery(sql, params);

          return {
            content: [{ type: "text", text: JSON.stringify(rows, null, 2) }],
            isError: false
          };
        } catch (error) {
          return {
            content: [
              {
                type: "text",
                text:
                  error instanceof Error
                    ? error.message
                    : "Unknown error occurred"
              }
            ],
            isError: true
          };
        }
      }

      case "list_tables": {
        try {
          const rows = await executeQuery("SHOW TABLES");
          return {
            content: [{ type: "text", text: JSON.stringify(rows, null, 2) }],
            isError: false
          };
        } catch (error) {
          return {
            content: [
              {
                type: "text",
                text:
                  error instanceof Error
                    ? error.message
                    : "Unknown error occurred"
              }
            ],
            isError: true
          };
        }
      }

      case "describe_table": {
        try {
          const tableName = request.params.arguments?.table as string;

          if (!tableName) {
            throw new Error("Table name is required");
          }

          const rows = await executeQuery("DESCRIBE ??", [tableName]);

          return {
            content: [{ type: "text", text: JSON.stringify(rows, null, 2) }],
            isError: false
          };
        } catch (error) {
          return {
            content: [
              {
                type: "text",
                text:
                  error instanceof Error
                    ? error.message
                    : "Unknown error occurred"
              }
            ],
            isError: true
          };
        }
      }

      case "list_databases": {
        try {
          const rows = await executeQuery("SHOW DATABASES");
          return {
            content: [{ type: "text", text: JSON.stringify(rows, null, 2) }],
            isError: false
          };
        } catch (error) {
          return {
            content: [
              {
                type: "text",
                text:
                  error instanceof Error
                    ? error.message
                    : "Unknown error occurred"
              }
            ],
            isError: true
          };
        }
      }

      case "use_database": {
        try {
          const dbName = request.params.arguments?.database as string;

          if (!dbName) {
            throw new Error("Database name is required");
          }

          await executeQuery("USE ??", [dbName]);
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
        } catch (error) {
          return {
            content: [
              {
                type: "text",
                text:
                  error instanceof Error
                    ? error.message
                    : "Unknown error occurred"
              }
            ],
            isError: true
          };
        }
      }

      case "set_readonly": {
        try {
          const readonly = request.params.arguments?.readonly as boolean;

          if (readonly === undefined) {
            throw new Error("readonly parameter is required");
          }

          connectionConfig.readonly = readonly;

          return {
            content: [
              {
                type: "text",
                text: `Read-only mode ${readonly ? "enabled" : "disabled"}`
              }
            ],
            isError: false
          };
        } catch (error) {
          return {
            content: [
              {
                type: "text",
                text:
                  error instanceof Error
                    ? error.message
                    : "Unknown error occurred"
              }
            ],
            isError: true
          };
        }
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
