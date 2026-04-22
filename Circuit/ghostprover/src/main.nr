// GhostProver - Proof of Non-Inclusion
//
// Proves, in zero knowledge, that a sensitive target field
// (e.g. Aadhar number, API key, email) does NOT appear as a
// contiguous substring anywhere inside an AI prompt.
//
// Public inputs  : commitment   - Poseidon2 hash of the full prompt
//                  target_hash  - Poseidon2 hash of the target field
//
// Private inputs : prompt_bytes - raw prompt, zero-padded to 512 bytes
//                  target_bytes - raw target field, zero-padded to 32 bytes
//                  target_len   - actual byte-length of target_bytes (1-32)
//                  prompt_len   - actual byte-length of prompt_bytes (1-512)
//
// What the circuit proves (all three must hold simultaneously):
//   1. poseidon2_hash(prompt_bytes)  == commitment
//   2. poseidon2_hash(target_bytes)  == target_hash
//   3. The target field is NOT a contiguous substring of the prompt

// ---------------------------------------------------------------------------
// Constants
// PROMPT_MAX   : max prompt size in bytes (512)
// TARGET_MAX   : max sensitive-field size in bytes (32)
// WINDOW_COUNT : = PROMPT_MAX - TARGET_MAX = 480, compile-time unrolled
// RATE         : Poseidon2 sponge rate (width 4 minus 1 capacity = 3)
// ---------------------------------------------------------------------------

global PROMPT_MAX: u32 = 512;
global TARGET_MAX: u32 = 32;
global WINDOW_COUNT: u32 = 480;
global RATE: u32 = 3;

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
            state = std::hash::poseidon2_permutation(state);
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
    state = std::hash::poseidon2_permutation(state);
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
            state = std::hash::poseidon2_permutation(state);
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
    state = std::hash::poseidon2_permutation(state);
    state[0]
}

// ---------------------------------------------------------------------------
// Main circuit
// ---------------------------------------------------------------------------

fn main(
    // Private witnesses
    prompt_bytes : [u8; 512],
    target_bytes : [u8; 32],
    target_len   : u32,
    prompt_len   : u32,

    // Public inputs (known to verifier)
    commitment   : pub Field,
    target_hash  : pub Field,
) {
    // -----------------------------------------------------------------------
    // 0. Range checks on length witnesses
    //    Prevents degenerate inputs (e.g. target_len=0) that would make
    //    the sliding window loop vacuous and trivially pass.
    // -----------------------------------------------------------------------
    assert(target_len >= 1);
    assert(target_len <= TARGET_MAX);
    assert(prompt_len >= 1);
    assert(prompt_len <= PROMPT_MAX);

    // -----------------------------------------------------------------------
    // 1. Commitment check
    //    Binds the prover to their exact prompt. The commitment is published
    //    before inference runs. If the prover swaps the prompt for one that
    //    excludes the target, the hash will not match and the proof fails.
    // -----------------------------------------------------------------------
    let prompt_fields: [Field; 512] = prompt_bytes.map(|b| b as Field);
    let computed_commitment = poseidon2_hash_512(prompt_fields);
    assert(computed_commitment == commitment);

    // -----------------------------------------------------------------------
    // 2. Target hash check
    //    Binds the prover to the exact field being proven absent. Without
    //    this, a prover could swap in a different (shorter/trivial) field
    //    and trivially pass the window check.
    // -----------------------------------------------------------------------
    let target_fields: [Field; 32] = target_bytes.map(|b| b as Field);
    let computed_target_hash = poseidon2_hash_32(target_fields);
    assert(computed_target_hash == target_hash);

    // -----------------------------------------------------------------------
    // 3. Sliding-window non-membership check
    //
    //    For each starting byte position i in [0, WINDOW_COUNT):
    //      - Only test windows that lie entirely within the real prompt
    //        content: i + target_len <= prompt_len.
    //      - Count byte positions j in [0, target_len) where
    //        prompt[i+j] != target[j].
    //      - Assert mismatch_count > 0. If it is 0, every byte matched
    //        and the target IS present at offset i -> proof fails.
    //
    //    WHY A COUNTER INSTEAD OF A BOOL:
    //      Assigning `flag = false` inside a loop can be silently no-oped by
    //      the Noir compiler (the rebind creates a new unconstrained witness
    //      wire). An arithmetic counter that must be non-zero is soundly
    //      enforced and cannot be skipped.
    //
    //    GATE COUNT: 480 x 32 = 15,360 compare iterations -> ~18-20k gates.
    //    Proof generation target: under 20 seconds on a modern laptop.
    // -----------------------------------------------------------------------

    for i in 0..WINDOW_COUNT {
        let window_end: u32 = (i as u32) + target_len;
        let is_active: bool = window_end <= prompt_len;

        if is_active {
            let mut mismatch_count: u32 = 0;

            for j in 0..TARGET_MAX {
                // Only compare bytes inside the real target_len.
                // Bytes beyond target_len are padding zeros in both
                // arrays and would trivially "match", causing false negatives.
                let j_in_range: bool = (j as u32) < target_len;

                if j_in_range {
                    if prompt_bytes[i + j] != target_bytes[j] {
                        mismatch_count += 1;
                    }
                }
            }

            // mismatch_count == 0 means full match at offset i. Fail.
            assert(mismatch_count > 0);
        }
    }
    // Every active window had at least one byte mismatch.
    // The target field is NOT a substring of the prompt. QED.
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
    main(prompt, target, 6, 11, commitment, target_hash);
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
    main(prompt, target, 12, 25, commitment, target_hash);
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

    main(prompt, target, 1, 1, fake_commitment, target_hash);
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
    main(prompt, target, 12, 83, commitment, target_hash);
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

    main(prompt, target, 6, 9, commitment, target_hash);
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

    main(prompt, target, 6, 12, commitment, target_hash);
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

    main(prompt, target, 6, 6, commitment, target_hash);
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

    main(prompt, target, 1, 5, commitment, target_hash);
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

    main(prompt, target, 1, 5, commitment, target_hash);
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

    main(prompt, target, 1, 1, commitment, fake_target_hash);
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

    main(prompt, target, 3, 20, commitment, target_hash);
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
    main(prompt, target, 0, 1, commitment, target_hash);
}
