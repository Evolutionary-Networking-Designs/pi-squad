/**
 * Adapted from rpiv-ask-user-question
 * https://github.com/juicesharp/rpiv-mono/tree/main/packages/rpiv-ask-user-question
 * © Sergii Guslystyi — MIT License
 *
 * Vendored subset: QuestionParams type, QuestionAnswer, QuestionnaireResult,
 * QuestionnaireError, and related constants.
 * TUI: simplified implementation. Install @juicesharp/rpiv-ask-user-question
 * for the full tabbed UI with previews and localization.
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