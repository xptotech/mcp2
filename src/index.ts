#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import * as mysql from "mysql2/promise";

class MySQLConnectionManager {
  private connection: mysql.Connection | null = null;
  private config: mysql.ConnectionOptions = {};

  isConnected(): boolean {
    return this.connection !== null;
  }

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

  async connect(config: mysql.ConnectionOptions): Promise<string> {
    try {
      if (this.connection) {
        await this.disconnect();
      }

      this.config = config;
      this.connection = await mysql.createConnection(config);

      return `성공적으로 ${config.host}:${config.port || 3306}의 ${
        config.database || "MySQL"
      }에 연결되었습니다.`;
    } catch (error: any) {
      return `데이터베이스 연결 실패: ${error.message}`;
    }
  }

  async disconnect(): Promise<string> {
    try {
      if (this.connection) {
        await this.connection.end();
        this.connection = null;
        this.config = {};
        return "데이터베이스 연결이 해제되었습니다.";
      }
      return "현재 연결된 데이터베이스가 없습니다.";
    } catch (error: any) {
      return `연결 해제 실패: ${error.message}`;
    }
  }

  async executeQuery(sql: string, params: any[] = []): Promise<any> {
    if (!this.connection) {
      throw new Error(
        "데이터베이스에 연결되어 있지 않습니다. 먼저 'connect' 도구를 사용하세요."
      );
    }

    try {
      const [rows] = await this.connection.execute(sql, params);
      return rows;
    } catch (error: any) {
      throw new Error(`쿼리 실행 실패: ${error.message}`);
    }
  }

  async useDatabase(database: string): Promise<string> {
    if (!this.connection) {
      throw new Error(
        "데이터베이스에 연결되어 있지 않습니다. 먼저 'connect' 도구를 사용하세요."
      );
    }

    try {
      await this.connection.execute(`USE \`${database}\``);
      this.config.database = database;
      return `데이터베이스가 '${database}'로 변경되었습니다.`;
    } catch (error: any) {
      throw new Error(`데이터베이스 변경 실패: ${error.message}`);
    }
  }
}

const server = new McpServer({
  name: "mysql",
  version: "1.0.0"
});
  
const dbManager = new MySQLConnectionManager();

server.tool("status", "현재 데이터베이스 연결 상태 확인", {}, async () => {
  const info = dbManager.getConnectionInfo();
  let statusText = "";

  if (info.connected) {
    statusText = `연결 상태: 연결됨\n호스트: ${info.host}\n포트: ${info.port}\n사용자: ${info.user}\n데이터베이스: ${info.database}`;
  } else {
    statusText =
      "연결 상태: 연결되지 않음\n'connect' 도구를 사용하여 데이터베이스에 연결하세요.";
  }

  return {
    content: [
      {
        type: "text",
        text: statusText
      }
    ]
  };
});

server.tool(
  "connect",
  "MySQL 데이터베이스에 연결",
  {
    host: z
      .string()
      .default("localhost")
      .describe("데이터베이스 서버 호스트명 또는 IP 주소"),
    port: z.string().default("3306").describe("데이터베이스 서버 포트"),
    user: z.string().default("root").describe("데이터베이스 사용자명"),
    password: z.string().default("").describe("데이터베이스 비밀번호"),
    database: z
      .string()
      .optional()
      .describe("연결할 데이터베이스 이름 (선택 사항)")
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

server.tool("disconnect", "현재 MySQL 데이터베이스 연결 종료", {}, async () => {
  const result = await dbManager.disconnect();

  return {
    content: [
      {
        type: "text",
        text: result
      }
    ]
  };
});

server.tool(
  "query",
  "연결된 데이터베이스에서 SQL 쿼리 실행",
  {
    sql: z.string().describe("실행할 SQL 쿼리"),
    params: z
      .array(z.any())
      .optional()
      .describe("준비된 문장의 매개변수 (선택 사항)")
  },
  async ({ sql, params = [] }) => {
    try {
      const results = await dbManager.executeQuery(sql, params);

      return {
        content: [
          {
            type: "text",
            text: `쿼리 실행 결과:\n${JSON.stringify(results, null, 2)}`
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

server.tool(
  "list_tables",
  "현재 데이터베이스의 테이블 목록 가져오기",
  {},
  async () => {
    try {
      const tables = await dbManager.executeQuery("SHOW TABLES");

      if (tables.length === 0) {
        return {
          content: [
            {
              type: "text",
              text: "현재 데이터베이스에 테이블이 없습니다."
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
            text: `테이블 목록:\n${tableNames}`
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

server.tool(
  "describe_table",
  "특정 테이블의 구조 가져오기",
  {
    table: z.string().describe("구조를 확인할 테이블 이름")
  },
  async ({ table }) => {
    try {
      const structure = await dbManager.executeQuery(`DESCRIBE \`${table}\``);

      return {
        content: [
          {
            type: "text",
            text: `'${table}' 테이블 구조:\n${JSON.stringify(
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

server.tool(
  "list_databases",
  "서버에서 액세스 가능한 모든 데이터베이스 목록 가져오기",
  {},
  async () => {
    try {
      const databases = await dbManager.executeQuery("SHOW DATABASES");

      const dbNames = databases.map((row: any) => row.Database).join("\n");

      return {
        content: [
          {
            type: "text",
            text: `데이터베이스 목록:\n${dbNames}`
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

server.tool(
  "use_database",
  "다른 데이터베이스로 전환",
  {
    database: z.string().describe("전환할 데이터베이스 이름")
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

async function main() {
  const defaultHost = process.env.MYSQL_HOST;
  const defaultUser = process.env.MYSQL_USER;
  const defaultPassword = process.env.MYSQL_PASSWORD;
  const defaultDatabase = process.env.MYSQL_DATABASE;

  if (defaultHost && defaultUser !== undefined) {
    try {
      await dbManager.connect({
        host: defaultHost,
        port: parseInt(process.env.MYSQL_PORT || "3306", 10),
        user: defaultUser,
        password: defaultPassword || "",
        database: defaultDatabase
      });
      console.error(`MySQL(${defaultHost})에 자동으로 연결되었습니다.`);
    } catch (error) {
      console.error("자동 연결 실패:", error);
    }
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("MySQL MCP 서버가 stdio에서 실행 중입니다");
}

main().catch((error) => {
  console.error("main()에서 치명적인 오류 발생:", error);
  process.exit(1);
});
