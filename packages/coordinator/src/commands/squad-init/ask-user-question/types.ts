/**
 * MIT License
 *
 * Copyright (c) 2026 juicesharp
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 *
 * Source: https://github.com/juicesharp/rpiv-mono/tree/main/packages/rpiv-ask-user-question
 * Adapted for @pi-squad/coordinator built-in ask_user_question fallback.
 * Vendored subset: QuestionParams, QuestionAnswer, QuestionnaireResult, and related constants.
 * Install @juicesharp/rpiv-ask-user-question for the full TUI with previews and localization.
 */

export const MAX_QUESTIONS = 4;
export const MIN_OPTIONS = 2;
export const MAX_OPTIONS = 4;

export interface QuestionOption {
  readonly label: string;
  readonly description: string;
}

export interface QuestionData {
  readonly question: string;
  readonly header: string;
  readonly options: readonly QuestionOption[];
  readonly multiSelect?: boolean;
}

export interface QuestionParams {
  readonly questions: readonly QuestionData[];
}

export interface QuestionAnswer {
  readonly questionIndex: number;
  readonly question: string;
  readonly kind: "option" | "custom" | "chat";
  readonly answer: string | null;
  readonly selected?: readonly string[];
}

export interface QuestionnaireResult {
  readonly answers: readonly QuestionAnswer[];
  readonly cancelled: boolean;
  readonly error?: "no_ui" | "no_questions" | "empty_options" | "too_many_questions";
}

export const QuestionParamsSchema = {
  type: "object",
  properties: {
    questions: {
      type: "array",
      minItems: 1,
      maxItems: MAX_QUESTIONS,
      items: {
        type: "object",
        required: ["question", "header", "options"],
        properties: {
          question: { type: "string" },
          header: { type: "string", maxLength: 16 },
          options: {
            type: "array",
            minItems: MIN_OPTIONS,
            maxItems: MAX_OPTIONS,
            items: {
              type: "object",
              required: ["label", "description"],
              properties: {
                label: { type: "string" },
                description: { type: "string" },
              },
            },
          },
          multiSelect: { type: "boolean" },
        },
      },
    },
  },
  required: ["questions"],
} as const;
