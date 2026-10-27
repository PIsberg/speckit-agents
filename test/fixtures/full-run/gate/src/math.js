/** The sum of a and b. */
export const add = (a, b) => a + b;

/** The sum of an array of numbers, 0 for an empty array. */
export const sum = (numbers) => numbers.reduce((total, n) => total + n, 0);
