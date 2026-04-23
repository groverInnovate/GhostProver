## Updates
### Update Progress Daily in this Format - Done, Issue Faced, Tommorrow's Plan 

# Mohit Grover 
* 21 April 2026 - End to End Technical Architecture Done 

* 22 April 2026 - 
1.  Wrote a basic Circuit in Noir which checks *Specific*n(Not Generic) Private Input like Adhaar Number, API key is not present in the prompt. ( Prompt  - 512 bytes, Secret - 32 bytes).
2.  Wrote the Poseidon2 sponge hash as the Required version was not publicly available. The non Inclusion is checked via Sliding Window Algorithm. Wrote some tests for edge cases
3. Proof Size and Time is sufficient for this project. 
###  Summary - v1 version of GhostProver Circuit is completed.

* 23 April 2026 - 
Wrote a Typescript Wrapper for calling the circuit from the Backend. It can generate proofs and verify them.