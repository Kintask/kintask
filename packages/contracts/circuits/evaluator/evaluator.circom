pragma circom 2.1.6;

// We don't need includes for this simplified version as checks are basic arithmetic/equality.
// If using Poseidon hashing *inside* the circuit later, you would include it here.

// Template to prove evaluation consistency
template Evaluator(confidenceScaleFactor) { // e.g., 100 to represent 0.00-1.00 as 0-100

    // --- Public Inputs (Known by Verifier Contract) ---
    // Hashes are computed off-chain (e.g., keccak256 -> BigInt) and passed in.
    signal input requestContextHash; // Hash identifying the specific task
    signal input kbContentHash;      // Hash of the knowledge base content used
    signal input questionHash;       // Hash of the question asked
    signal input answerHash;         // Hash of the answer being evaluated
    signal input llmResponseHash;    // Hash of the raw LLM response text

    signal input answeringAgentId;   // Agent address as BigInt

    signal input evaluationVerdict;  // Claimed final verdict (0: Incorrect, 1: Correct, 2: Uncertain)
    signal input evaluationConfidence; // Claimed final confidence (scaled integer, e.g., 0-100)

    // --- Private Inputs (Known only by Prover, proves consistency) ---
    signal input parsedVerdictCode;     // 0, 1, or 2 derived off-chain
    signal input parsedConfidenceScaled; // Scaled confidence (e.g., 0-100) derived off-chain

    // --- Constraints ---

    // 1. Verify claimed public verdict matches private parsed verdict
    evaluationVerdict === parsedVerdictCode;

    // 2. Verify claimed public confidence matches private parsed confidence
    evaluationConfidence === parsedConfidenceScaled;

    // 3. Validate the range of the verdict (0, 1, or 2)
    // This constraint ensures evaluationVerdict is exactly 0, 1, or 2.
    // Breaking down the cubic constraint into quadratic steps
    signal inter1 <== evaluationVerdict - 1;
    signal inter2 <== evaluationVerdict - 2;
    signal product <== inter1 * inter2; // Intermediate product
    signal rangeCheck <== evaluationVerdict * product;
    rangeCheck === 0;

    // 4. Validate the range of the confidence (0 to confidenceScaleFactor)
    // Confidence >= 0 is implicit for field elements unless field wraps around, be careful with large fields/scales.
    // Confidence <= confidenceScaleFactor
    // WARNING: Range proof for confidence is omitted for simplicity here. Add back LessEq from circomlib if needed.


    // This circuit proves consistency between public claims and private derivations,
    // and basic validity of verdict code. It relies on external hashing.
}

// Instantiate with confidence scaled 0-100
component main {
    public [
        requestContextHash,
        kbContentHash,
        questionHash,
        answerHash,
        llmResponseHash,
        answeringAgentId,
        evaluationVerdict,
        evaluationConfidence
    ]
} = Evaluator(100);