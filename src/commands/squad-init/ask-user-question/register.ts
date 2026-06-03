import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { probeModule } from "../detect.js";
import {
  MAX_OPTIONS,
  MAX_QUESTIONS,
  MIN_OPTIONS,
  QuestionParamsSchema,
  type QuestionAnswer,
  type QuestionData,
  type QuestionParams,
  type QuestionnaireResult,
} from "./types.js";

function formatQuestion(question: QuestionData, index: number): string {
  const lines = [`${index + 1}. ${question.question}`];
  for (const [optionIndex, option] of question.options.entries()) {
    lines.push(`   ${optionIndex + 1}. ${option.label} — ${option.description}`);
  }
  return lines.join("\n");
}

function formatQuestionnaire(params: QuestionParams): string {
  return params.questions.map((question, index) => formatQuestion(question, index)).join("\n\n");
}

function buildTextResponse(_params: QuestionParams): QuestionnaireResult {
  return {
    answers: [],
    cancelled: false,
  };
}

function validationError(error: QuestionnaireResult["error"], message: string) {
  const result: QuestionnaireResult = { answers: [], cancelled: true, error };
  return { content: [{ type: "text" as const, text: message }], details: result };
}

function parseOptionSelection(input: string, question: QuestionData): QuestionAnswer {
  const trimmed = input.trim();
  const parts = question.multiSelect
    ? trimmed
        .split(",")
        .map((part) => part.trim())
        .filter((part) => part.length > 0)
    : [trimmed];
  const indices = parts.map((part) => Number.parseInt(part, 10) - 1);
  const matchedOptions =
    parts.length > 0 &&
    parts.every(
      (part, index) => /^\d+$/u.test(part) && indices[index] >= 0 && indices[index] < question.options.length,
    )
      ? indices
          .map((index) => question.options[index])
          .filter((option): option is NonNullable<typeof option> => Boolean(option))
      : [];

  if (matchedOptions.length > 0) {
    const selected = matchedOptions.map((option) => option.label);
    return {
      questionIndex: -1,
      question: question.question,
      kind: "option",
      answer: question.multiSelect ? selected.join(", ") : selected[0] ?? null,
      selected: question.multiSelect ? selected : undefined,
    };
  }

  return {
    questionIndex: -1,
    question: question.question,
    kind: trimmed.length > 0 ? "custom" : "chat",
    answer: trimmed || null,
  };
}

export { probeModule };

export function registerBuiltinAskUserQuestion(pi: ExtensionAPI): void {
  if (typeof pi.registerTool !== "function") {
    return;
  }

  pi.registerTool({
    name: "ask_user_question",
    label: "Ask User Question",
    description:
      "Ask the user one or more structured questions during execution. Use when you need to gather requirements, clarify ambiguous instructions, or get decisions on implementation choices. Each question requires 2-4 options with labels and descriptions.",
    promptSnippet:
      "Ask the user structured questions (2-4 options each) when requirements are ambiguous",
    promptGuidelines: [
      "Use ask_user_question when the user's request is underspecified. You can ask up to 4 questions per invocation.",
      "Each question must have 2-4 options. Every option needs a concise label and a description.",
      "Do not stack multiple ask_user_question calls back-to-back — group all clarifying questions into one call.",
    ],
    parameters: QuestionParamsSchema as never,
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const typed = params as unknown as QuestionParams;

      if (!typed.questions || typed.questions.length === 0) {
        return validationError("no_questions", "No questions provided.");
      }

      if (typed.questions.length > MAX_QUESTIONS) {
        return validationError("too_many_questions", "Too many questions provided.");
      }

      if (
        typed.questions.some(
          (question) =>
            question.options.length < MIN_OPTIONS || question.options.length > MAX_OPTIONS,
        )
      ) {
        return validationError("empty_options", "Each question must include 2-4 options.");
      }

      const text = formatQuestionnaire(typed);
      if (!ctx.hasUI) {
        const result = buildTextResponse(typed);
        return { content: [{ type: "text", text }], details: result };
      }

      try {
        const answers: QuestionAnswer[] = [];
        for (const [index, question] of typed.questions.entries()) {
          const promptText = `${question.header}\n\n${formatQuestion(question, index)}\n\n${question.multiSelect ? "Enter number(s) separated by commas" : "Enter number"} (or type a custom answer):`;
          const response = await ctx.ui.input(promptText, question.multiSelect ? "1,2" : "1");

          if (response === undefined) {
            const result: QuestionnaireResult = { answers, cancelled: true };
            return {
              content: [{ type: "text", text: "Questionnaire cancelled." }],
              details: result,
            };
          }

          const answer = parseOptionSelection(response, question);
          answers.push({ ...answer, questionIndex: index });
        }

        const result: QuestionnaireResult = { answers, cancelled: false };
        const summary = answers.map((answer, index) => `Q${index + 1}: ${answer.answer ?? "(skipped)"}`).join("; ");
        return { content: [{ type: "text", text: `Answers: ${summary}` }], details: result };
      } catch {
        const result = buildTextResponse(typed);
        return { content: [{ type: "text", text }], details: result };
      }
    },
  } as Parameters<ExtensionAPI["registerTool"]>[0]);
}
