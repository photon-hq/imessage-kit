/**
 * attributedBody BLOBs (base64) carrying confirmed @mentions.
 *
 * Mention fixtures are archived by Foundation's NSArchiver — the same
 * typedstream format Messages stores — rather than captured from chat.db,
 * because real tagged messages carry other people's phone numbers. The
 * handles here are placeholders.
 */

// "mushy bet Jordan $20 and ann@x.test too": "Jordan" tagged +15550001111,
// "ann@x.test" tagged ann@x.test.
export const MENTION_BODY_TWO_TAGS =
    'BAtzdHJlYW10eXBlZIHoA4QBQISEhBlOU011dGFibGVBdHRyaWJ1dGVkU3RyaW5nAISEEk5TQXR0cmlidXRlZFN0cmluZwCEhAhOU09iamVjdACFkoSEhA9OU011dGFibGVTdHJpbmcBhIQITlNTdHJpbmcBlYQBKydtdXNoeSBiZXQgSm9yZGFuICQyMCBhbmQgYW5uQHgudGVzdCB0b2+GhAJpSQEKkoSEhAxOU0RpY3Rpb25hcnkAlYQBaQGShJiYHV9fa0lNTWVzc2FnZVBhcnRBdHRyaWJ1dGVOYW1lhpKEhIQITlNOdW1iZXIAhIQHTlNWYWx1ZQCVhAEqhIQBcZ8AhoaZAgaShJqbApKEmJgcX19rSU1NZW50aW9uQ29uZmlybWVkTWVudGlvboaShJiYDCsxNTU1MDAwMTExMYaSm5KchpkBCZkDCpKEmpsCkqGShJiYCmFubkB4LnRlc3SGkpuSnIaZAQSG'

// "🎲 Jordan Lee in?": "Jordan Lee" tagged +15550001111, split into two runs
// by an extra attribute on "Lee"; the emoji puts it at UTF-16 offset 3.
export const MENTION_BODY_SPLIT_RUN =
    'BAtzdHJlYW10eXBlZIHoA4QBQISEhBlOU011dGFibGVBdHRyaWJ1dGVkU3RyaW5nAISEEk5TQXR0cmlidXRlZFN0cmluZwCEhAhOU09iamVjdACFkoSEhA9OU011dGFibGVTdHJpbmcBhIQITlNTdHJpbmcBlYQBKxPwn46yIEpvcmRhbiBMZWUgaW4/hoQCaUkBA5KEhIQMTlNEaWN0aW9uYXJ5AJWEAWkBkoSYmB1fX2tJTU1lc3NhZ2VQYXJ0QXR0cmlidXRlTmFtZYaShISECE5TTnVtYmVyAISEB05TVmFsdWUAlYQBKoSEAXGfAIaGmQIHkoSamwKShJiYHF9fa0lNTWVudGlvbkNvbmZpcm1lZE1lbnRpb26GkoSYmAwrMTU1NTAwMDExMTGGkpuSnIaZAwOShJqbA5KbkpySoZKikoSYmBpfX2tJTVRleHRCb2xkQXR0cmlidXRlTmFtZYaShJ2en58BhoaZAQSG'
