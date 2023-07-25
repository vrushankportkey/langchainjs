import { Embeddings } from "../embeddings/base.js";
import { Document } from "../document.js";
import { BaseRetriever, BaseRetrieverInput } from "../schema/retriever.js";
import { Serializable } from "../load/serializable.js";
import {
  CallbackManagerForRetrieverRun,
  Callbacks,
} from "../callbacks/manager.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AddDocumentOptions = Record<string, any>;

export interface VectorStoreRetrieverInput<V extends VectorStore>
  extends BaseRetrieverInput {
  vectorStore: V;
  k?: number;
  filter?: V["FilterType"];
}

export class VectorStoreRetriever<
  V extends VectorStore = VectorStore
> extends BaseRetriever {
  get lc_namespace() {
    return ["langchain", "retrievers", "base"];
  }

  vectorStore: V;

  k = 4;

  filter?: V["FilterType"];

  _vectorstoreType(): string {
    return this.vectorStore._vectorstoreType();
  }

  constructor(fields: VectorStoreRetrieverInput<V>) {
    super(fields);
    this.vectorStore = fields.vectorStore;
    this.k = fields.k ?? this.k;
    this.filter = fields.filter;
  }

  async _getRelevantDocuments(
    query: string,
    runManager?: CallbackManagerForRetrieverRun
  ): Promise<Document[]> {
    return this.vectorStore.similaritySearch(
      query,
      this.k,
      this.filter,
      runManager?.getChild("vectorstore")
    );
  }

  async addDocuments(
    documents: Document[],
    options?: AddDocumentOptions
  ): Promise<string[] | void> {
    return this.vectorStore.addDocuments(documents, options);
  }
}

export abstract class VectorStore extends Serializable {
  declare FilterType: object;

  lc_namespace = ["langchain", "vectorstores", this._vectorstoreType()];

  embeddings: Embeddings;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  constructor(embeddings: Embeddings, dbConfig: Record<string, any>) {
    super(dbConfig);
    this.embeddings = embeddings;
  }

  abstract _vectorstoreType(): string;

  abstract addVectors(
    vectors: number[][],
    documents: Document[],
    options?: AddDocumentOptions
  ): Promise<string[] | void>;

  abstract addDocuments(
    documents: Document[],
    options?: AddDocumentOptions
  ): Promise<string[] | void>;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async delete(_params?: Record<string, any>): Promise<void> {
    throw new Error("Not implemented.");
  }

  abstract similaritySearchVectorWithScore(
    query: number[],
    k: number,
    filter?: this["FilterType"]
  ): Promise<[Document, number][]>;

  async similaritySearch(
    query: string,
    k = 4,
    filter: this["FilterType"] | undefined = undefined,
    _callbacks: Callbacks | undefined = undefined // implement passing to embedQuery later
  ): Promise<Document[]> {
    const results = await this.similaritySearchVectorWithScore(
      await this.embeddings.embedQuery(query),
      k,
      filter
    );

    return results.map((result) => result[0]);
  }

  async similaritySearchWithScore(
    query: string,
    k = 4,
    filter: this["FilterType"] | undefined = undefined,
    _callbacks: Callbacks | undefined = undefined // implement passing to embedQuery later
  ): Promise<[Document, number][]> {
    return this.similaritySearchVectorWithScore(
      await this.embeddings.embedQuery(query),
      k,
      filter
    );
  }

  static fromTexts(
    _texts: string[],
    _metadatas: object[] | object,
    _embeddings: Embeddings,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    _dbConfig: Record<string, any>
  ): Promise<VectorStore> {
    throw new Error(
      "the Langchain vectorstore implementation you are using forgot to override this, please report a bug"
    );
  }

  static fromDocuments(
    _docs: Document[],
    _embeddings: Embeddings,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    _dbConfig: Record<string, any>
  ): Promise<VectorStore> {
    throw new Error(
      "the Langchain vectorstore implementation you are using forgot to override this, please report a bug"
    );
  }

  asRetriever(
    kOrFields?: number | VectorStoreRetrieverInput<this>,
    filter?: this["FilterType"],
    callbacks?: Callbacks,
    tags?: string[],
    metadata?: Record<string, unknown>,
    verbose?: boolean
  ): VectorStoreRetriever<this> {
    if (typeof kOrFields === "number") {
      return new VectorStoreRetriever({
        vectorStore: this,
        k: kOrFields,
        filter,
        tags: [...(tags ?? []), this._vectorstoreType()],
        metadata,
        verbose,
        callbacks,
      });
    } else {
      return new VectorStoreRetriever({
        vectorStore: this,
        k: kOrFields?.k,
        filter: kOrFields?.filter,
        tags: [...(kOrFields?.tags ?? []), this._vectorstoreType()],
        metadata: kOrFields?.metadata,
        verbose: kOrFields?.verbose,
        callbacks: kOrFields?.callbacks,
      });
    }
  }
}

export abstract class SaveableVectorStore extends VectorStore {
  abstract save(directory: string): Promise<void>;

  static load(
    _directory: string,
    _embeddings: Embeddings
  ): Promise<SaveableVectorStore> {
    throw new Error("Not implemented");
  }
}
