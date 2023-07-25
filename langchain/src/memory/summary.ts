import { BaseLanguageModel } from "../base_language/index.js";
import { LLMChain } from "../chains/llm_chain.js";
import { BasePromptTemplate } from "../prompts/base.js";
import { BaseMessage, SystemMessage } from "../schema/index.js";
import {
  getBufferString,
  InputValues,
  MemoryVariables,
  OutputValues,
} from "./base.js";
import { BaseChatMemory, BaseChatMemoryInput } from "./chat_memory.js";
import { SUMMARY_PROMPT } from "./prompt.js";

export interface ConversationSummaryMemoryInput
  extends BaseConversationSummaryMemoryInput {}

export interface BaseConversationSummaryMemoryInput
  extends BaseChatMemoryInput {
  llm: BaseLanguageModel;
  memoryKey?: string;
  humanPrefix?: string;
  aiPrefix?: string;
  prompt?: BasePromptTemplate;
  summaryChatMessageClass?: new (content: string) => BaseMessage;
}

export abstract class BaseConversationSummaryMemory extends BaseChatMemory {
  memoryKey = "history";

  humanPrefix = "Human";

  aiPrefix = "AI";

  llm: BaseLanguageModel;

  prompt: BasePromptTemplate = SUMMARY_PROMPT;

  summaryChatMessageClass: new (content: string) => BaseMessage = SystemMessage;

  constructor(fields: BaseConversationSummaryMemoryInput) {
    const {
      returnMessages,
      inputKey,
      outputKey,
      chatHistory,
      humanPrefix,
      aiPrefix,
      llm,
      prompt,
      summaryChatMessageClass,
    } = fields;

    super({ returnMessages, inputKey, outputKey, chatHistory });

    this.memoryKey = fields?.memoryKey ?? this.memoryKey;
    this.humanPrefix = humanPrefix ?? this.humanPrefix;
    this.aiPrefix = aiPrefix ?? this.aiPrefix;
    this.llm = llm;
    this.prompt = prompt ?? this.prompt;
    this.summaryChatMessageClass =
      summaryChatMessageClass ?? this.summaryChatMessageClass;
  }

  async predictNewSummary(
    messages: BaseMessage[],
    existingSummary: string
  ): Promise<string> {
    const newLines = getBufferString(messages, this.humanPrefix, this.aiPrefix);
    const chain = new LLMChain({ llm: this.llm, prompt: this.prompt });
    return await chain.predict({
      summary: existingSummary,
      new_lines: newLines,
    });
  }
}

export class ConversationSummaryMemory extends BaseConversationSummaryMemory {
  buffer = "";

  constructor(fields: ConversationSummaryMemoryInput) {
    super(fields);
  }

  get memoryKeys() {
    return [this.memoryKey];
  }

  async loadMemoryVariables(_: InputValues): Promise<MemoryVariables> {
    if (this.returnMessages) {
      const result = {
        [this.memoryKey]: [new this.summaryChatMessageClass(this.buffer)],
      };
      return result;
    }
    const result = { [this.memoryKey]: this.buffer };
    return result;
  }

  async saveContext(
    inputValues: InputValues,
    outputValues: OutputValues
  ): Promise<void> {
    await super.saveContext(inputValues, outputValues);
    const messages = await this.chatHistory.getMessages();
    this.buffer = await this.predictNewSummary(messages.slice(-2), this.buffer);
  }

  async clear() {
    await super.clear();
    this.buffer = "";
  }
}
