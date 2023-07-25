import { PromptTemplate } from "../prompts/prompt.js";
import { BaseLanguageModel } from "../base_language/index.js";
import { SerializedChatVectorDBQAChain } from "./serde.js";
import {
  ChainValues,
  BaseMessage,
  HumanMessage,
  AIMessage,
} from "../schema/index.js";
import { BaseRetriever } from "../schema/retriever.js";
import { BaseChain, ChainInputs } from "./base.js";
import { LLMChain } from "./llm_chain.js";
import { QAChainParams, loadQAChain } from "./question_answering/load.js";
import { CallbackManagerForChainRun } from "../callbacks/manager.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type LoadValues = Record<string, any>;

const question_generator_template = `Given the following conversation and a follow up question, rephrase the follow up question to be a standalone question.

Chat History:
{chat_history}
Follow Up Input: {question}
Standalone question:`;

export interface ConversationalRetrievalQAChainInput extends ChainInputs {
  retriever: BaseRetriever;
  combineDocumentsChain: BaseChain;
  questionGeneratorChain: LLMChain;
  returnSourceDocuments?: boolean;
  inputKey?: string;
}

export class ConversationalRetrievalQAChain
  extends BaseChain
  implements ConversationalRetrievalQAChainInput
{
  inputKey = "question";

  chatHistoryKey = "chat_history";

  get inputKeys() {
    return [this.inputKey, this.chatHistoryKey];
  }

  get outputKeys() {
    return this.combineDocumentsChain.outputKeys.concat(
      this.returnSourceDocuments ? ["sourceDocuments"] : []
    );
  }

  retriever: BaseRetriever;

  combineDocumentsChain: BaseChain;

  questionGeneratorChain: LLMChain;

  returnSourceDocuments = false;

  constructor(fields: ConversationalRetrievalQAChainInput) {
    super(fields);
    this.retriever = fields.retriever;
    this.combineDocumentsChain = fields.combineDocumentsChain;
    this.questionGeneratorChain = fields.questionGeneratorChain;
    this.inputKey = fields.inputKey ?? this.inputKey;
    this.returnSourceDocuments =
      fields.returnSourceDocuments ?? this.returnSourceDocuments;
  }

  static getChatHistoryString(
    chatHistory: string | BaseMessage[] | string[][]
  ) {
    let historyMessages: BaseMessage[];
    if (Array.isArray(chatHistory)) {
      // TODO: Deprecate on a breaking release
      if (
        Array.isArray(chatHistory[0]) &&
        typeof chatHistory[0][0] === "string"
      ) {
        console.warn(
          "Passing chat history as an array of strings is deprecated.\nPlease see https://js.langchain.com/docs/modules/chains/popular/chat_vector_db#externally-managed-memory for more information."
        );
        historyMessages = chatHistory.flat().map((stringMessage, i) => {
          if (i % 2 === 0) {
            return new HumanMessage(stringMessage);
          } else {
            return new AIMessage(stringMessage);
          }
        });
      } else {
        historyMessages = chatHistory as BaseMessage[];
      }
      return historyMessages
        .map((chatMessage) => {
          if (chatMessage._getType() === "human") {
            return `Human: ${chatMessage.content}`;
          } else if (chatMessage._getType() === "ai") {
            return `Assistant: ${chatMessage.content}`;
          } else {
            return `${chatMessage.content}`;
          }
        })
        .join("\n");
    }
    return chatHistory;
  }

  /** @ignore */
  async _call(
    values: ChainValues,
    runManager?: CallbackManagerForChainRun
  ): Promise<ChainValues> {
    if (!(this.inputKey in values)) {
      throw new Error(`Question key ${this.inputKey} not found.`);
    }
    if (!(this.chatHistoryKey in values)) {
      throw new Error(`Chat history key ${this.chatHistoryKey} not found.`);
    }
    const question: string = values[this.inputKey];
    const chatHistory: string =
      ConversationalRetrievalQAChain.getChatHistoryString(
        values[this.chatHistoryKey]
      );
    let newQuestion = question;
    if (chatHistory.length > 0) {
      const result = await this.questionGeneratorChain.call(
        {
          question,
          chat_history: chatHistory,
        },
        runManager?.getChild("question_generator")
      );
      const keys = Object.keys(result);
      if (keys.length === 1) {
        newQuestion = result[keys[0]];
      } else {
        throw new Error(
          "Return from llm chain has multiple values, only single values supported."
        );
      }
    }
    const docs = await this.retriever.getRelevantDocuments(
      newQuestion,
      runManager?.getChild("retriever")
    );
    const inputs = {
      question: newQuestion,
      input_documents: docs,
      chat_history: chatHistory,
    };
    const result = await this.combineDocumentsChain.call(
      inputs,
      runManager?.getChild("combine_documents")
    );
    if (this.returnSourceDocuments) {
      return {
        ...result,
        sourceDocuments: docs,
      };
    }
    return result;
  }

  _chainType(): string {
    return "conversational_retrieval_chain";
  }

  static async deserialize(
    _data: SerializedChatVectorDBQAChain,
    _values: LoadValues
  ): Promise<ConversationalRetrievalQAChain> {
    throw new Error("Not implemented.");
  }

  serialize(): SerializedChatVectorDBQAChain {
    throw new Error("Not implemented.");
  }

  static fromLLM(
    llm: BaseLanguageModel,
    retriever: BaseRetriever,
    options: {
      outputKey?: string; // not used
      returnSourceDocuments?: boolean;
      /** @deprecated Pass in questionGeneratorChainOptions.template instead */
      questionGeneratorTemplate?: string;
      /** @deprecated Pass in qaChainOptions.prompt instead */
      qaTemplate?: string;
      qaChainOptions?: QAChainParams;
      questionGeneratorChainOptions?: {
        llm?: BaseLanguageModel;
        template?: string;
      };
    } & Omit<
      ConversationalRetrievalQAChainInput,
      "retriever" | "combineDocumentsChain" | "questionGeneratorChain"
    > = {}
  ): ConversationalRetrievalQAChain {
    const {
      questionGeneratorTemplate,
      qaTemplate,
      qaChainOptions = {
        type: "stuff",
        prompt: qaTemplate
          ? PromptTemplate.fromTemplate(qaTemplate)
          : undefined,
      },
      questionGeneratorChainOptions,
      verbose,
      ...rest
    } = options;

    const qaChain = loadQAChain(llm, qaChainOptions);

    const questionGeneratorChainPrompt = PromptTemplate.fromTemplate(
      questionGeneratorChainOptions?.template ??
        questionGeneratorTemplate ??
        question_generator_template
    );
    const questionGeneratorChain = new LLMChain({
      prompt: questionGeneratorChainPrompt,
      llm: questionGeneratorChainOptions?.llm ?? llm,
      verbose,
    });
    const instance = new this({
      retriever,
      combineDocumentsChain: qaChain,
      questionGeneratorChain,
      verbose,
      ...rest,
    });
    return instance;
  }
}
