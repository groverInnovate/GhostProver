// GhostProver - Proof of Non-Inclusion (v2: Pattern Mode)
//
// Proves, in zero knowledge, that a sensitive target field
// (e.g. Aadhar number, API key, email) does NOT appear as a
// contiguous substring anywhere inside an AI prompt.
//
// Supports two modes:
//   mode=0 (exact):   prove a SPECIFIC byte string is absent
//   mode=1 (pattern): prove NO string matching a character-class
//                     pattern is present (e.g. "any 12 digits")
//
// Public inputs  : commitment   - Poseidon2 hash of the full prompt
//                  target_hash  - mode 0: hash(target_bytes)
//                                 mode 1: hash(pattern_types ++ pattern_values)
//
// Private inputs : prompt_bytes    - raw prompt, zero-padded to 512 bytes
//                  target_bytes    - (mode 0) raw target, zero-padded to 32
//                  pattern_types   - (mode 1) character class per position
//                  pattern_values  - (mode 1) exact byte for CLASS_EXACT
//                  target_len      - length of target/pattern (1-32)
//                  prompt_len      - length of prompt (1-512)
//                  mode            - 0=exact, 1=pattern

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

global PROMPT_MAX: u32 = 512;
global TARGET_MAX: u32 = 32;
global WINDOW_COUNT: u32 = 480;
global RATE: u32 = 3;

// Character class IDs for pattern mode
global CLASS_EXACT: u8 = 0;       // matches pattern_values[j] exactly
global CLASS_DIGIT: u8 = 1;       // 0-9  (ASCII 48-57)
global CLASS_ALPHA_LOWER: u8 = 2; // a-z  (ASCII 97-122)
global CLASS_ALPHA_UPPER: u8 = 3; // A-Z  (ASCII 65-90)
global CLASS_ALPHA: u8 = 4;       // a-z or A-Z
global CLASS_ALPHANUM: u8 = 5;    // a-z, A-Z, or 0-9
global CLASS_HEX: u8 = 6;         // 0-9, a-f, A-F
global CLASS_BASE64: u8 = 7;      // a-z, A-Z, 0-9, +, /, =
global CLASS_ANY: u8 = 8;         // matches any byte

// ---------------------------------------------------------------------------
// Poseidon2 sponge hash
//
// The stdlib's Poseidon2 struct is pub(crate) and inaccessible from user code.
// However, std::hash::poseidon2_permutation IS public and accepts [Field; 4].
// We replicate the same sponge construction the stdlib uses internally:
//
//   - State width = 4  (3 rate lanes + 1 capacity lane)
//   - IV = input_length * 2^64  (placed in the capacity lane)
//   - Absorb: add up to 3 elements into state[0..2], then permute
//   - Squeeze: permute one final time, return state[0]
//
// This produces identical hashes to std::hash::poseidon2::Poseidon2::hash
// for fixed-length inputs when message_size == N.
// ---------------------------------------------------------------------------

// Poseidon2 sponge hash for 512 Field elements.
fn poseidon2_hash_512(input: [Field; 512]) -> Field {
    let two_pow_64: Field = 18446744073709551616;
    let iv: Field = 512 * two_pow_64;

   
    let mut state: [Field; 4] = [0, 0, 0, iv];
    let mut cache: [Field; 3] = [0; 3];
    let mut cache_size: u32 = 0;

    for i in 0..512 {
        if cache_size == RATE {
            
            for k in 0..3 {
                state[k] += cache[k];
            }
            state = std::hash::poseidon2_permutation(state, 4);
            cache = [0; 3];
            cache[0] = input[i];
            cache_size = 1;
        } else {
            cache[cache_size] = input[i];
            cache_size += 1;
        }
    }

    // Final squeeze: add remaining cache into state and permute
    for k in 0..3 {
        if k < cache_size {
            state[k] += cache[k];
        }
    }
    state = std::hash::poseidon2_permutation(state, 4);
    state[0]
}

// Poseidon2 sponge hash for 32 Field elements.
fn poseidon2_hash_32(input: [Field; 32]) -> Field {
    let two_pow_64: Field = 18446744073709551616;
    let iv: Field = 32 * two_pow_64;

    let mut state: [Field; 4] = [0, 0, 0, iv];
    let mut cache: [Field; 3] = [0; 3];
    let mut cache_size: u32 = 0;

    for i in 0..32 {
        if cache_size == RATE {
            for k in 0..3 {
                state[k] += cache[k];
            }
            state = std::hash::poseidon2_permutation(state, 4);
            cache = [0; 3];
            cache[0] = input[i];
            cache_size = 1;
        } else {
            cache[cache_size] = input[i];
            cache_size += 1;
        }
    }

    for k in 0..3 {
        if k < cache_size {
            state[k] += cache[k];
        }
    }
    state = std::hash::poseidon2_permutation(state, 4);
    state[0]
}

// Poseidon2 sponge hash for 64 Field elements.
// Used for hashing the pattern descriptor (pattern_types ++ pattern_values).
fn poseidon2_hash_64(input: [Field; 64]) -> Field {
    let two_pow_64: Field = 18446744073709551616;
    let iv: Field = 64 * two_pow_64;

    let mut state: [Field; 4] = [0, 0, 0, iv];
    let mut cache: [Field; 3] = [0; 3];
    let mut cache_size: u32 = 0;

    for i in 0..64 {
        if cache_size == RATE {
            for k in 0..3 {
                state[k] += cache[k];
            }
            state = std::hash::poseidon2_permutation(state, 4);
            cache = [0; 3];
            cache[0] = input[i];
            cache_size = 1;
        } else {
            cache[cache_size] = input[i];
            cache_size += 1;
        }
    }

    for k in 0..3 {
        if k < cache_size {
            state[k] += cache[k];
        }
    }
    state = std::hash::poseidon2_permutation(state, 4);
    state[0]
}

// ---------------------------------------------------------------------------
// Character class matcher (pattern mode)
//
// Returns true if `byte` belongs to the character class `class_type`.
// For CLASS_EXACT, the byte must equal `class_value`.
// ---------------------------------------------------------------------------

fn matches_class(byte: u8, class_type: u8, class_value: u8) -> bool {
    let is_digit = (byte >= 48) & (byte <= 57);
    let is_lower = (byte >= 97) & (byte <= 122);
    let is_upper = (byte >= 65) & (byte <= 90);
    let is_alpha = is_lower | is_upper;
    let is_alnum = is_alpha | is_digit;
    let is_hex_lower = (byte >= 97) & (byte <= 102);
    let is_hex_upper = (byte >= 65) & (byte <= 70);
    let is_hex = is_digit | is_hex_lower | is_hex_upper;
    let is_b64_extra = (byte == 43) | (byte == 47) | (byte == 61);
    let is_base64 = is_alnum | is_b64_extra;

    if class_type == CLASS_EXACT { byte == class_value }
    else if class_type == CLASS_DIGIT { is_digit }
    else if class_type == CLASS_ALPHA_LOWER { is_lower }
    else if class_type == CLASS_ALPHA_UPPER { is_upper }
    else if class_type == CLASS_ALPHA { is_alpha }
    else if class_type == CLASS_ALPHANUM { is_alnum }
    else if class_type == CLASS_HEX { is_hex }
    else if class_type == CLASS_BASE64 { is_base64 }
    else if class_type == CLASS_ANY { true }
    else { false }
}

// ---------------------------------------------------------------------------
// Main circuit  (v2: dual-mode exact + pattern)
// ---------------------------------------------------------------------------

fn main(
    // Private witnesses
    prompt_bytes    : [u8; 512],
    target_bytes    : [u8; 32],   // used in exact mode (mode=0)
    pattern_types   : [u8; 32],   // used in pattern mode (mode=1)
    pattern_values  : [u8; 32],   // used in pattern mode (mode=1)
    target_len      : u32,
    prompt_len      : u32,
    mode            : u8,         // 0=exact, 1=pattern

    // Public inputs (known to verifier)
    commitment   : pub Field,
    target_hash  : pub Field,
) {
    // -----------------------------------------------------------------------
    // 0. Range checks
    // -----------------------------------------------------------------------
    assert(target_len >= 1);
    assert(target_len <= TARGET_MAX);
    assert(prompt_len >= 1);
    assert(prompt_len <= PROMPT_MAX);
    assert((mode == 0) | (mode == 1));

    // -----------------------------------------------------------------------
    // 1. Commitment check (same for both modes)
    // -----------------------------------------------------------------------
    let prompt_fields: [Field; 512] = prompt_bytes.map(|b| b as Field);
    let computed_commitment = poseidon2_hash_512(prompt_fields);
    assert(computed_commitment == commitment);

    // -----------------------------------------------------------------------
    // 2. Target / pattern hash check
    //    mode 0: hash(target_bytes)
    //    mode 1: hash(pattern_types ++ pattern_values)  (64 elements)
    // -----------------------------------------------------------------------
    if mode == 0 {
        let target_fields: [Field; 32] = target_bytes.map(|b| b as Field);
        let computed = poseidon2_hash_32(target_fields);
        assert(computed == target_hash);
    } else {
        let mut descriptor: [Field; 64] = [0; 64];
        for k in 0..32 {
            descriptor[k] = pattern_types[k] as Field;
            descriptor[k + 32] = pattern_values[k] as Field;
        }
        let computed = poseidon2_hash_64(descriptor);
        assert(computed == target_hash);
    }

    // -----------------------------------------------------------------------
    // 3. Sliding-window non-membership check
    //
    //    mode 0 (exact):   prompt[i+j] != target_bytes[j]
    //    mode 1 (pattern): !matches_class(prompt[i+j], type[j], value[j])
    //
    //    A mismatch_count of 0 means full match -> proof FAILS.
    // -----------------------------------------------------------------------

    for i in 0..WINDOW_COUNT {
        let window_end: u32 = (i as u32) + target_len;
        let is_active: bool = window_end <= prompt_len;

        if is_active {
            let mut mismatch_count: u32 = 0;

            for j in 0..TARGET_MAX {
                let j_in_range: bool = (j as u32) < target_len;

                if j_in_range {
                    if mode == 0 {
                        // Exact mode: byte-for-byte comparison
                        if prompt_bytes[i + j] != target_bytes[j] {
                            mismatch_count += 1;
                        }
                    } else {
                        // Pattern mode: character class comparison
                        let matched = matches_class(
                            prompt_bytes[i + j],
                            pattern_types[j],
                            pattern_values[j],
                        );
                        if !matched {
                            mismatch_count += 1;
                        }
                    }
                }
            }

            assert(mismatch_count > 0);
        }
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[test]
fn test_field_not_present() {
    // Prompt: "Hello World" (11 bytes), padded to 512
    let mut prompt: [u8; 512] = [0; 512];
    prompt[0]  = 72;  // H
    prompt[1]  = 101; // e
    prompt[2]  = 108; // l
    prompt[3]  = 108; // l
    prompt[4]  = 111; // o
    prompt[5]  = 32;  // space
    prompt[6]  = 87;  // W
    prompt[7]  = 111; // o
    prompt[8]  = 114; // r
    prompt[9]  = 108; // l
    prompt[10] = 100; // d

    // Target: "SECRET" (6 bytes), padded to 32
    let mut target: [u8; 32] = [0; 32];
    target[0] = 83; // S
    target[1] = 69; // E
    target[2] = 67; // C
    target[3] = 82; // R
    target[4] = 69; // E
    target[5] = 84; // T

    let prompt_fields: [Field; 512] = prompt.map(|b| b as Field);
    let target_fields: [Field; 32]  = target.map(|b| b as Field);

    let commitment  = poseidon2_hash_512(prompt_fields);
    let target_hash = poseidon2_hash_32(target_fields);

    // "SECRET" is not in "Hello World" -> should pass
    // mode=0, pattern arrays unused (zeros)
    let pat_types: [u8; 32] = [0; 32];
    let pat_vals: [u8; 32] = [0; 32];
    main(prompt, target, pat_types, pat_vals, 6, 11, 0, commitment, target_hash);
}

#[test(should_fail)]
fn test_field_present_should_fail() {
    // Prompt: "my Aadhar is 123456789012" (25 bytes)
    let mut prompt: [u8; 512] = [0; 512];
    prompt[0]  = 109; // m
    prompt[1]  = 121; // y
    prompt[2]  = 32;  // space
    prompt[3]  = 65;  // A
    prompt[4]  = 97;  // a
    prompt[5]  = 100; // d
    prompt[6]  = 104; // h
    prompt[7]  = 97;  // a
    prompt[8]  = 114; // r
    prompt[9]  = 32;  // space
    prompt[10] = 105; // i
    prompt[11] = 115; // s
    prompt[12] = 32;  // space
    prompt[13] = 49;  // 1
    prompt[14] = 50;  // 2
    prompt[15] = 51;  // 3
    prompt[16] = 52;  // 4
    prompt[17] = 53;  // 5
    prompt[18] = 54;  // 6
    prompt[19] = 55;  // 7
    prompt[20] = 56;  // 8
    prompt[21] = 57;  // 9
    prompt[22] = 48;  // 0
    prompt[23] = 49;  // 1
    prompt[24] = 50;  // 2

    // Target: "123456789012" (12 bytes)
    let mut target: [u8; 32] = [0; 32];
    target[0]  = 49;
    target[1]  = 50;
    target[2]  = 51;
    target[3]  = 52;
    target[4]  = 53;
    target[5]  = 54;
    target[6]  = 55;
    target[7]  = 56;
    target[8]  = 57;
    target[9]  = 48;
    target[10] = 49;
    target[11] = 50;

    let prompt_fields: [Field; 512] = prompt.map(|b| b as Field);
    let target_fields: [Field; 32]  = target.map(|b| b as Field);

    let commitment  = poseidon2_hash_512(prompt_fields);
    let target_hash = poseidon2_hash_32(target_fields);

    // "123456789012" IS present in the prompt -> should fail
    let pat_types: [u8; 32] = [0; 32];
    let pat_vals: [u8; 32] = [0; 32];
    main(prompt, target, pat_types, pat_vals, 12, 25, 0, commitment, target_hash);
}

#[test(should_fail)]
fn test_tampered_commitment_should_fail() {
    let mut prompt: [u8; 512] = [0; 512];
    prompt[0] = 65; // "A"

    let mut target: [u8; 32] = [0; 32];
    target[0] = 66; // "B"

    let target_fields: [Field; 32] = target.map(|b| b as Field);
    let target_hash = poseidon2_hash_32(target_fields);

    // Deliberately wrong commitment -> should fail
    let fake_commitment: Field = 0;
    let pat_types: [u8; 32] = [0; 32];
    let pat_vals: [u8; 32] = [0; 32];
    main(prompt, target, pat_types, pat_vals, 1, 1, 0, fake_commitment, target_hash);
}

// ---------------------------------------------------------------------------
// Helper: print Poseidon2 hashes for Prover.toml
// Run with: nargo test --show-output test_print_prover_hashes
// ---------------------------------------------------------------------------

#[test]
fn test_print_prover_hashes() {
    // Realistic scenario: medical AI query + Aadhar number as sensitive field
    // Prompt: "What are the treatment options for a patient with high blood pressure and diabetes?"
    // Target: "234567890123" (12-digit Aadhar number)
    let prompt: [u8; 512] = [
        87, 104, 97, 116, 32, 97, 114, 101, 32, 116, 104, 101, 32, 116, 114, 101,
        97, 116, 109, 101, 110, 116, 32, 111, 112, 116, 105, 111, 110, 115, 32, 102,
        111, 114, 32, 97, 32, 112, 97, 116, 105, 101, 110, 116, 32, 119, 105, 116,
        104, 32, 104, 105, 103, 104, 32, 98, 108, 111, 111, 100, 32, 112, 114, 101,
        115, 115, 117, 114, 101, 32, 97, 110, 100, 32, 100, 105, 97, 98, 101, 116,
        101, 115, 63, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0
    ];

    let target: [u8; 32] = [
        50, 51, 52, 53, 54, 55, 56, 57, 48, 49, 50, 51, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0
    ];

    let prompt_fields: [Field; 512] = prompt.map(|b| b as Field);
    let target_fields: [Field; 32]  = target.map(|b| b as Field);

    let commitment  = poseidon2_hash_512(prompt_fields);
    let target_hash = poseidon2_hash_32(target_fields);

    // Print values for Prover.toml
    println(f"commitment  = \"{commitment}\"");
    println(f"target_hash = \"{target_hash}\"");

    // Also verify the full circuit works with these inputs
    // "234567890123" is NOT in the medical query -> should pass
    let pat_types: [u8; 32] = [0; 32];
    let pat_vals: [u8; 32] = [0; 32];
    main(prompt, target, pat_types, pat_vals, 12, 83, 0, commitment, target_hash);
}

// ---------------------------------------------------------------------------
// Edge-case tests
// ---------------------------------------------------------------------------

// Target appears at the very start of the prompt (offset 0)
#[test(should_fail)]
fn test_target_at_start_should_fail() {
    // Prompt starts with "SECRET..."
    let mut prompt: [u8; 512] = [0; 512];
    prompt[0] = 83;  // S
    prompt[1] = 69;  // E
    prompt[2] = 67;  // C
    prompt[3] = 82;  // R
    prompt[4] = 69;  // E
    prompt[5] = 84;  // T
    prompt[6] = 32;  // space
    prompt[7] = 72;  // H
    prompt[8] = 105; // i

    let mut target: [u8; 32] = [0; 32];
    target[0] = 83; // S
    target[1] = 69; // E
    target[2] = 67; // C
    target[3] = 82; // R
    target[4] = 69; // E
    target[5] = 84; // T

    let prompt_fields: [Field; 512] = prompt.map(|b| b as Field);
    let target_fields: [Field; 32]  = target.map(|b| b as Field);
    let commitment  = poseidon2_hash_512(prompt_fields);
    let target_hash = poseidon2_hash_32(target_fields);

    let pat_types: [u8; 32] = [0; 32];
    let pat_vals: [u8; 32] = [0; 32];
    main(prompt, target, pat_types, pat_vals, 6, 9, 0, commitment, target_hash);
}

// Target appears at the very end of the prompt
#[test(should_fail)]
fn test_target_at_end_should_fail() {
    // Prompt: "Hello KEY123" (12 bytes), target: "KEY123" at end
    let mut prompt: [u8; 512] = [0; 512];
    prompt[0]  = 72;  // H
    prompt[1]  = 101; // e
    prompt[2]  = 108; // l
    prompt[3]  = 108; // l
    prompt[4]  = 111; // o
    prompt[5]  = 32;  // space
    prompt[6]  = 75;  // K
    prompt[7]  = 69;  // E
    prompt[8]  = 89;  // Y
    prompt[9]  = 49;  // 1
    prompt[10] = 50;  // 2
    prompt[11] = 51;  // 3

    let mut target: [u8; 32] = [0; 32];
    target[0] = 75;  // K
    target[1] = 69;  // E
    target[2] = 89;  // Y
    target[3] = 49;  // 1
    target[4] = 50;  // 2
    target[5] = 51;  // 3

    let prompt_fields: [Field; 512] = prompt.map(|b| b as Field);
    let target_fields: [Field; 32]  = target.map(|b| b as Field);
    let commitment  = poseidon2_hash_512(prompt_fields);
    let target_hash = poseidon2_hash_32(target_fields);

    let pat_types: [u8; 32] = [0; 32];
    let pat_vals: [u8; 32] = [0; 32];
    main(prompt, target, pat_types, pat_vals, 6, 12, 0, commitment, target_hash);
}

// Near-miss: target differs by one byte -> should PASS (field is absent)
#[test]
fn test_near_miss_one_byte_off() {
    // Prompt contains "SECRE7" but target is "SECRET"
    let mut prompt: [u8; 512] = [0; 512];
    prompt[0] = 83;  // S
    prompt[1] = 69;  // E
    prompt[2] = 67;  // C
    prompt[3] = 82;  // R
    prompt[4] = 69;  // E
    prompt[5] = 55;  // 7 (not T=84)

    let mut target: [u8; 32] = [0; 32];
    target[0] = 83; // S
    target[1] = 69; // E
    target[2] = 67; // C
    target[3] = 82; // R
    target[4] = 69; // E
    target[5] = 84; // T

    let prompt_fields: [Field; 512] = prompt.map(|b| b as Field);
    let target_fields: [Field; 32]  = target.map(|b| b as Field);
    let commitment  = poseidon2_hash_512(prompt_fields);
    let target_hash = poseidon2_hash_32(target_fields);

    let pat_types: [u8; 32] = [0; 32];
    let pat_vals: [u8; 32] = [0; 32];
    main(prompt, target, pat_types, pat_vals, 6, 6, 0, commitment, target_hash);
}

// Single-byte target (minimum field size)
#[test]
fn test_single_byte_target_absent() {
    // Prompt: "Hello" (no 'Z' anywhere), target: "Z"
    let mut prompt: [u8; 512] = [0; 512];
    prompt[0] = 72;  // H
    prompt[1] = 101; // e
    prompt[2] = 108; // l
    prompt[3] = 108; // l
    prompt[4] = 111; // o

    let mut target: [u8; 32] = [0; 32];
    target[0] = 90; // Z

    let prompt_fields: [Field; 512] = prompt.map(|b| b as Field);
    let target_fields: [Field; 32]  = target.map(|b| b as Field);
    let commitment  = poseidon2_hash_512(prompt_fields);
    let target_hash = poseidon2_hash_32(target_fields);

    let pat_types: [u8; 32] = [0; 32];
    let pat_vals: [u8; 32] = [0; 32];
    main(prompt, target, pat_types, pat_vals, 1, 5, 0, commitment, target_hash);
}

// Single-byte target that IS present -> should fail
#[test(should_fail)]
fn test_single_byte_target_present_should_fail() {
    // Prompt: "Hello", target: "H" which is at offset 0
    let mut prompt: [u8; 512] = [0; 512];
    prompt[0] = 72;  // H
    prompt[1] = 101; // e
    prompt[2] = 108; // l
    prompt[3] = 108; // l
    prompt[4] = 111; // o

    let mut target: [u8; 32] = [0; 32];
    target[0] = 72; // H

    let prompt_fields: [Field; 512] = prompt.map(|b| b as Field);
    let target_fields: [Field; 32]  = target.map(|b| b as Field);
    let commitment  = poseidon2_hash_512(prompt_fields);
    let target_hash = poseidon2_hash_32(target_fields);

    let pat_types: [u8; 32] = [0; 32];
    let pat_vals: [u8; 32] = [0; 32];
    main(prompt, target, pat_types, pat_vals, 1, 5, 0, commitment, target_hash);
}

// Tampered target_hash -> should fail
#[test(should_fail)]
fn test_tampered_target_hash_should_fail() {
    let mut prompt: [u8; 512] = [0; 512];
    prompt[0] = 65; // "A"

    let mut target: [u8; 32] = [0; 32];
    target[0] = 66; // "B"

    let prompt_fields: [Field; 512] = prompt.map(|b| b as Field);
    let commitment = poseidon2_hash_512(prompt_fields);

    // Deliberately wrong target hash
    let fake_target_hash: Field = 0;

    let pat_types: [u8; 32] = [0; 32];
    let pat_vals: [u8; 32] = [0; 32];
    main(prompt, target, pat_types, pat_vals, 1, 1, 0, commitment, fake_target_hash);
}

// Repeated pattern: prompt is "aaaaaa...", target is "aaa" -> should fail
#[test(should_fail)]
fn test_repeated_pattern_should_fail() {
    let mut prompt: [u8; 512] = [0; 512];
    for i in 0..20 {
        prompt[i] = 97; // 'a'
    }

    let mut target: [u8; 32] = [0; 32];
    target[0] = 97; // a
    target[1] = 97; // a
    target[2] = 97; // a

    let prompt_fields: [Field; 512] = prompt.map(|b| b as Field);
    let target_fields: [Field; 32]  = target.map(|b| b as Field);
    let commitment  = poseidon2_hash_512(prompt_fields);
    let target_hash = poseidon2_hash_32(target_fields);

    let pat_types: [u8; 32] = [0; 32];
    let pat_vals: [u8; 32] = [0; 32];
    main(prompt, target, pat_types, pat_vals, 3, 20, 0, commitment, target_hash);
}

// target_len = 0 should fail range check
#[test(should_fail)]
fn test_zero_target_len_should_fail() {
    let prompt: [u8; 512] = [0; 512];
    let target: [u8; 32] = [0; 32];

    let prompt_fields: [Field; 512] = prompt.map(|b| b as Field);
    let target_fields: [Field; 32]  = target.map(|b| b as Field);
    let commitment  = poseidon2_hash_512(prompt_fields);
    let target_hash = poseidon2_hash_32(target_fields);

    // target_len = 0 violates assert(target_len >= 1)
    let pat_types: [u8; 32] = [0; 32];
    let pat_vals: [u8; 32] = [0; 32];
    main(prompt, target, pat_types, pat_vals, 0, 1, 0, commitment, target_hash);
}

// ===========================================================================
// Pattern-mode tests (v2)
// ===========================================================================

// Aadhar pattern: 12 consecutive digits. Prompt has no digits -> PASS
#[test]
fn test_pattern_aadhar_absent() {
    let mut prompt: [u8; 512] = [0; 512];
    prompt[0]  = 72;  // H
    prompt[1]  = 101; // e
    prompt[2]  = 108; // l
    prompt[3]  = 108; // l
    prompt[4]  = 111; // o
    prompt[5]  = 32;
    prompt[6]  = 87;  // W
    prompt[7]  = 111; // o
    prompt[8]  = 114; // r
    prompt[9]  = 108; // l
    prompt[10] = 100; // d

    let mut pat_types: [u8; 32] = [0; 32];
    for i in 0..12 { pat_types[i] = 1; }
    let pat_vals: [u8; 32] = [0; 32];

    let mut descriptor: [Field; 64] = [0; 64];
    for k in 0..32 {
        descriptor[k] = pat_types[k] as Field;
        descriptor[k + 32] = pat_vals[k] as Field;
    }
    let pattern_hash = poseidon2_hash_64(descriptor);
    let prompt_fields: [Field; 512] = prompt.map(|b| b as Field);
    let commitment = poseidon2_hash_512(prompt_fields);
    let target: [u8; 32] = [0; 32];
    main(prompt, target, pat_types, pat_vals, 12, 11, 1, commitment, pattern_hash);
}

// Aadhar pattern: prompt CONTAINS 12 consecutive digits -> FAIL
#[test(should_fail)]
fn test_pattern_aadhar_present_should_fail() {
    let mut prompt: [u8; 512] = [0; 512];
    prompt[0]  = 105; // i
    prompt[1]  = 100; // d
    prompt[2]  = 32;
    prompt[3]  = 50;  // 2
    prompt[4]  = 51;  // 3
    prompt[5]  = 52;  // 4
    prompt[6]  = 53;  // 5
    prompt[7]  = 54;  // 6
    prompt[8]  = 55;  // 7
    prompt[9]  = 56;  // 8
    prompt[10] = 57;  // 9
    prompt[11] = 48;  // 0
    prompt[12] = 49;  // 1
    prompt[13] = 50;  // 2
    prompt[14] = 51;  // 3
    prompt[15] = 32;
    prompt[16] = 111; // o
    prompt[17] = 107; // k

    let mut pat_types: [u8; 32] = [0; 32];
    for i in 0..12 { pat_types[i] = 1; }
    let pat_vals: [u8; 32] = [0; 32];

    let mut descriptor: [Field; 64] = [0; 64];
    for k in 0..32 {
        descriptor[k] = pat_types[k] as Field;
        descriptor[k + 32] = pat_vals[k] as Field;
    }
    let pattern_hash = poseidon2_hash_64(descriptor);
    let prompt_fields: [Field; 512] = prompt.map(|b| b as Field);
    let commitment = poseidon2_hash_512(prompt_fields);
    let target: [u8; 32] = [0; 32];
    main(prompt, target, pat_types, pat_vals, 12, 18, 1, commitment, pattern_hash);
}

// PAN Card pattern: UPPER x5 + DIGIT x4 + UPPER x1 -> PASS (not in prompt)
#[test]
fn test_pattern_pan_absent() {
    let mut prompt: [u8; 512] = [0; 512];
    let text: [u8; 20] = [99,104,101,99,107,32,112,97,121,109,101,110,116,32,115,116,97,116,117,115];
    for i in 0..20 { prompt[i] = text[i]; }

    let mut pat_types: [u8; 32] = [0; 32];
    pat_types[0] = 3; pat_types[1] = 3; pat_types[2] = 3;
    pat_types[3] = 3; pat_types[4] = 3;
    pat_types[5] = 1; pat_types[6] = 1; pat_types[7] = 1;
    pat_types[8] = 1; pat_types[9] = 3;
    let pat_vals: [u8; 32] = [0; 32];

    let mut descriptor: [Field; 64] = [0; 64];
    for k in 0..32 {
        descriptor[k] = pat_types[k] as Field;
        descriptor[k + 32] = pat_vals[k] as Field;
    }
    let pattern_hash = poseidon2_hash_64(descriptor);
    let prompt_fields: [Field; 512] = prompt.map(|b| b as Field);
    let commitment = poseidon2_hash_512(prompt_fields);
    let target: [u8; 32] = [0; 32];
    main(prompt, target, pat_types, pat_vals, 10, 20, 1, commitment, pattern_hash);
}

// AWS key: exact "AKIA" + 16 alphanumeric present in prompt -> FAIL
#[test(should_fail)]
fn test_pattern_aws_key_present_should_fail() {
    let mut prompt: [u8; 512] = [0; 512];
    let prefix: [u8; 14] = [109,121,32,107,101,121,32,105,115,32,65,75,73,65];
    for i in 0..14 { prompt[i] = prefix[i]; }
    let key: [u8; 16] = [97,98,99,100,101,102,103,104,49,50,51,52,53,54,55,56];
    for i in 0..16 { prompt[14 + i] = key[i]; }

    let mut pat_types: [u8; 32] = [0; 32];
    pat_types[0] = 0; pat_types[1] = 0; pat_types[2] = 0; pat_types[3] = 0;
    for i in 4..20 { pat_types[i] = 5; }
    let mut pat_vals: [u8; 32] = [0; 32];
    pat_vals[0] = 65; pat_vals[1] = 75; pat_vals[2] = 73; pat_vals[3] = 65;

    let mut descriptor: [Field; 64] = [0; 64];
    for k in 0..32 {
        descriptor[k] = pat_types[k] as Field;
        descriptor[k + 32] = pat_vals[k] as Field;
    }
    let pattern_hash = poseidon2_hash_64(descriptor);
    let prompt_fields: [Field; 512] = prompt.map(|b| b as Field);
    let commitment = poseidon2_hash_512(prompt_fields);
    let target: [u8; 32] = [0; 32];
    main(prompt, target, pat_types, pat_vals, 20, 30, 1, commitment, pattern_hash);
}

// Print pattern hashes for TS cross-validation
#[test]
fn test_print_pattern_hashes() {
    let mut aadhar_types: [u8; 32] = [0; 32];
    for i in 0..12 { aadhar_types[i] = 1; }
    let aadhar_vals: [u8; 32] = [0; 32];
    let mut desc: [Field; 64] = [0; 64];
    for k in 0..32 {
        desc[k] = aadhar_types[k] as Field;
        desc[k + 32] = aadhar_vals[k] as Field;
    }
    let aadhar_hash = poseidon2_hash_64(desc);
    println(f"aadhar_pattern_hash = \"{aadhar_hash}\"");

    let mut pan_types: [u8; 32] = [0; 32];
    pan_types[0] = 3; pan_types[1] = 3; pan_types[2] = 3;
    pan_types[3] = 3; pan_types[4] = 3;
    pan_types[5] = 1; pan_types[6] = 1; pan_types[7] = 1;
    pan_types[8] = 1; pan_types[9] = 3;
    let pan_vals: [u8; 32] = [0; 32];
    let mut desc2: [Field; 64] = [0; 64];
    for k in 0..32 {
        desc2[k] = pan_types[k] as Field;
        desc2[k + 32] = pan_vals[k] as Field;
    }
    let pan_hash = poseidon2_hash_64(desc2);
    println(f"pan_pattern_hash = \"{pan_hash}\"");
}
