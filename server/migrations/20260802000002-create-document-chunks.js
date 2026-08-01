"use strict";

/**
 * `document_chunks` holds the actual embedded chunks of a document used by the
 * RAG search. Each row is one chunk; the vector(1024) column holds its
 * Mistral embedding. We also keep a derived tsvector column (`search_tsv`)
 * and a content hash so the embedding task can detect changed chunks without
 * re-embedding unchanged ones.
 */
module.exports = {
  up: async (queryInterface, Sequelize) => {
    // Enable required extensions in case the previous migration was skipped
    // on a database that pre-dates pgvector. The extension is idempotent.
    await queryInterface.sequelize.query("CREATE EXTENSION IF NOT EXISTS vector;");
    await queryInterface.sequelize.query("CREATE EXTENSION IF NOT EXISTS pg_trgm;");

    await queryInterface.createTable("document_chunks", {
      id: {
        type: Sequelize.UUID,
        primaryKey: true,
        allowNull: false,
        defaultValue: Sequelize.literal("uuid_generate_v4()"),
      },
      teamId: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: "teams", key: "id" },
        onDelete: "CASCADE",
      },
      documentId: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: "documents", key: "id" },
        onDelete: "CASCADE",
      },
      chunkIndex: {
        type: Sequelize.INTEGER,
        allowNull: false,
      },
      content: {
        type: Sequelize.TEXT,
        allowNull: false,
      },
      contentHash: {
        type: Sequelize.CHAR(64),
        allowNull: false,
      },
      heading: {
        type: Sequelize.TEXT,
        allowNull: true,
      },
      startOffset: {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
      endOffset: {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
      embedding: {
        type: "vector(384)",
        allowNull: true,
      },
      model: {
        type: Sequelize.STRING(64),
        allowNull: false,
        defaultValue: "Xenova/paraphrase-multilingual-MiniLM-L6-v2",
      },
      createdAt: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal("NOW()"),
      },
      updatedAt: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal("NOW()"),
      },
    });

    await queryInterface.addIndex("document_chunks", ["teamId", "documentId"], {
      name: "document_chunks_team_document_idx",
    });
    await queryInterface.addIndex("document_chunks", ["documentId", "contentHash"], {
      name: "document_chunks_content_hash_idx",
    });
    await queryInterface.addIndex("document_chunks", {
      name: "document_chunks_embedding_hnsw_idx",
      fields: [Sequelize.literal("embedding vector_cosine_ops")],
      using: "hnsw",
    });
    await queryInterface.addIndex("document_chunks", {
      name: "document_chunks_content_trgm_idx",
      fields: ["content"],
      using: "gin",
      operator: "gin_trgm_ops",
    });

    // Add a tsvector column and a trigger that keeps it in sync with `content`
    // so the keyword side of the hybrid search can use Postgres full-text
    // search. Mirrors the pattern from the documents.searchVector migration.
    await queryInterface.sequelize.query(`
      ALTER TABLE document_chunks ADD COLUMN "search_tsv" tsvector;
    `);

    await queryInterface.sequelize.query(`
      CREATE OR REPLACE FUNCTION document_chunks_search_trigger() RETURNS trigger AS $$
      begin
        new.search_tsv :=
          setweight(to_tsvector('simple', coalesce(new.content, '')), 'A') ||
          setweight(to_tsvector('simple', coalesce(new.heading, '')), 'B');
        return new;
      end
      $$ LANGUAGE plpgsql;
    `);

    await queryInterface.sequelize.query(`
      CREATE TRIGGER document_chunks_search_update
      BEFORE INSERT OR UPDATE OF content, heading ON document_chunks
      FOR EACH ROW EXECUTE FUNCTION document_chunks_search_trigger();
    `);

    await queryInterface.sequelize.query(`
      CREATE INDEX document_chunks_search_tsv_idx
      ON document_chunks USING GIN ("search_tsv");
    `);
  },

  down: async (queryInterface) => {
    await queryInterface.sequelize.query(`
      DROP TRIGGER IF EXISTS document_chunks_search_update ON document_chunks;
    `);
    await queryInterface.sequelize.query(`
      DROP FUNCTION IF EXISTS document_chunks_search_trigger();
    `);
    await queryInterface.dropTable("document_chunks");
  },
};
