/** The distinct non-empty values of a list, in Hebrew order: the suggestions of a text field. */
export const distinct = (list: (string | null)[]) => [...new Set(list.filter((v): v is string => Boolean(v)))].sort((a, b) => a.localeCompare(b, "he"));
