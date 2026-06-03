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
export declare const MAX_QUESTIONS = 4;
export declare const MIN_OPTIONS = 2;
export declare const MAX_OPTIONS = 4;
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
export declare const QuestionParamsSchema: {
    readonly type: "object";
    readonly properties: {
        readonly questions: {
            readonly type: "array";
            readonly minItems: 1;
            readonly maxItems: 4;
            readonly items: {
                readonly type: "object";
                readonly required: readonly ["question", "header", "options"];
                readonly properties: {
                    readonly question: {
                        readonly type: "string";
                    };
                    readonly header: {
                        readonly type: "string";
                        readonly maxLength: 16;
                    };
                    readonly options: {
                        readonly type: "array";
                        readonly minItems: 2;
                        readonly maxItems: 4;
                        readonly items: {
                            readonly type: "object";
                            readonly required: readonly ["label", "description"];
                            readonly properties: {
                                readonly label: {
                                    readonly type: "string";
                                };
                                readonly description: {
                                    readonly type: "string";
                                };
                            };
                        };
                    };
                    readonly multiSelect: {
                        readonly type: "boolean";
                    };
                };
            };
        };
    };
    readonly required: readonly ["questions"];
};
//# sourceMappingURL=types.d.ts.map