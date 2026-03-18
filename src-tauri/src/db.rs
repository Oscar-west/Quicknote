use tauri_plugin_sql::{Migration, MigrationKind};

pub fn get_migrations() -> Vec<Migration> {
    vec![
        Migration {
            version: 1,
            description: "create_ideas_table",
            sql: "CREATE TABLE IF NOT EXISTS ideas (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                text TEXT NOT NULL,
                project TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );",
            kind: MigrationKind::Up,
        },
        Migration {
            version: 2,
            description: "create_folders_table",
            sql: "CREATE TABLE IF NOT EXISTS folders (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL UNIQUE,
                color TEXT NOT NULL DEFAULT '#6b7280',
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );
            INSERT OR IGNORE INTO folders (id, name, color) VALUES (1, 'Inbox', '#6b7280');
            ALTER TABLE ideas ADD COLUMN folder_id INTEGER REFERENCES folders(id) DEFAULT 1;
            UPDATE ideas SET folder_id = 1 WHERE folder_id IS NULL;",
            kind: MigrationKind::Up,
        },
        Migration {
            version: 3,
            description: "add_review_status",
            sql: "ALTER TABLE ideas ADD COLUMN review_status TEXT DEFAULT NULL;",
            kind: MigrationKind::Up,
        },
    ]
}
