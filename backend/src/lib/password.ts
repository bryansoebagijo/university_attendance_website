import { randomInt } from "node:crypto";
import bcrypt from "bcryptjs";
import { z } from "zod";

export const BCRYPT_ROUNDS = 10;

/** New passwords: 8–200 characters, at least one letter and one digit. */
export const newPasswordSchema = z
  .string()
  .min(8)
  .max(200)
  .regex(/[A-Za-z]/, "needs a letter")
  .regex(/\d/, "needs a digit");

// No look-alike characters (0/O, 1/l/I), so it can be read out or written down safely.
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";

/** A one-time password an admin hands to a user, who must change it at first login. */
export function temporaryPassword(length = 10): string {
  let out = "";
  while (!/[A-Za-z]/.test(out) || !/\d/.test(out)) {
    out = Array.from({ length }, () => ALPHABET[randomInt(ALPHABET.length)]).join("");
  }
  return out;
}

export const hashPassword = (p: string) => bcrypt.hash(p, BCRYPT_ROUNDS);
