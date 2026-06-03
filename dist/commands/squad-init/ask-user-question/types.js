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
export const MAX_QUESTIONS = 4;
export const MIN_OPTIONS = 2;
export const MAX_OPTIONS = 4;
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
};
//# sourceMappingURL=types.js.map