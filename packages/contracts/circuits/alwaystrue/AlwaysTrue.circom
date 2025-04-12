pragma circom 2.1.6;

template AlwaysTrue () {
    // Define inputs to match the *signature* of the contract function
    // Even though we don't use them all for constraints.
    signal input input0;
    signal input input1;
    signal input input2;
    signal input input3;
    signal input input4;
    signal input input5;
    signal input input6;
    signal input input7;

    // Minimal constraint that is always true
    1 === 1;
}

component main {
    // Declare the same number of public inputs as the contract expects (8)
    public [ input0, input1, input2, input3, input4, input5, input6, input7 ]
} = AlwaysTrue();