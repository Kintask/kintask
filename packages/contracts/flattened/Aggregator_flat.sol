
pragma solidity ^0.8.17;


/// @title Filecoin actors' common types for Solidity.
/// @author Zondax AG
library CommonTypes {
    uint constant UniversalReceiverHookMethodNum = 3726118371;

    /// @param idx index for the failure in batch
    /// @param code failure code
    struct FailCode {
        uint32 idx;
        uint32 code;
    }

    /// @param success_count total successes in batch
    /// @param fail_codes list of failures code and index for each failure in batch
    struct BatchReturn {
        uint32 success_count;
        FailCode[] fail_codes;
    }

    /// @param type_ asset type
    /// @param payload payload corresponding to asset type
    struct UniversalReceiverParams {
        uint32 type_;
        bytes payload;
    }

    /// @param val contains the actual arbitrary number written as binary
    /// @param neg indicates if val is negative or not
    struct BigInt {
        bytes val;
        bool neg;
    }

    /// @param data filecoin address in bytes format
    struct FilAddress {
        bytes data;
    }

    /// @param data cid in bytes format
    struct Cid {
        bytes data;
    }

    /// @param data deal proposal label in bytes format (it can be utf8 string or arbitrary bytes string).
    /// @param isString indicates if the data is string or raw bytes
    struct DealLabel {
        bytes data;
        bool isString;
    }

    type FilActorId is uint64;

    type ChainEpoch is int64;
}


// File @zondax/filecoin-solidity/contracts/v0.8/cbor/BigIntCbor.sol@v4.0.3

/*******************************************************************************
 *   (c) 2022 Zondax AG
 *
 *  Licensed under the Apache License, Version 2.0 (the "License");
 *  you may not use this file except in compliance with the License.
 *  You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 *  Unless required by applicable law or agreed to in writing, software
 *  distributed under the License is distributed on an "AS IS" BASIS,
 *  WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 *  See the License for the specific language governing permissions and
 *  limitations under the License.
 ********************************************************************************/
//
// THIS CODE WAS SECURITY REVIEWED BY KUDELSKI SECURITY, BUT NOT FORMALLY AUDITED

// Original license: SPDX_License_Identifier: Apache-2.0
pragma solidity ^0.8.17;

/// @title This library is a set of functions meant to handle CBOR serialization and deserialization for BigInt type
/// @author Zondax AG
library BigIntCBOR {
    /// @notice serialize BigInt instance to bytes
    /// @param num BigInt instance to serialize
    /// @return serialized BigInt as bytes
    function serializeBigInt(CommonTypes.BigInt memory num) internal pure returns (bytes memory) {
        bytes memory raw = new bytes(num.val.length + 1);

        raw[0] = num.neg == true ? bytes1(0x01) : bytes1(0x00);

        uint index = 1;
        for (uint i = 0; i < num.val.length; i++) {
            raw[index] = num.val[i];
            index++;
        }

        return raw;
    }

    /// @notice deserialize big int (encoded as bytes) to BigInt instance
    /// @param raw as bytes to parse
    /// @return parsed BigInt instance
    function deserializeBigInt(bytes memory raw) internal pure returns (CommonTypes.BigInt memory) {
        if (raw.length == 0) {
            return CommonTypes.BigInt(hex"00", false);
        }

        bytes memory val = new bytes(raw.length - 1);
        bool neg = false;

        if (raw[0] == 0x01) {
            neg = true;
        }

        for (uint i = 1; i < raw.length; i++) {
            val[i - 1] = raw[i];
        }

        return CommonTypes.BigInt(val, neg);
    }
}


// File @zondax/filecoin-solidity/contracts/v0.8/utils/CborDecode.sol@v4.0.3

/*******************************************************************************
 *   (c) 2022 Zondax AG
 *
 *  Licensed under the Apache License, Version 2.0 (the "License");
 *  you may not use this file except in compliance with the License.
 *  You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 *  Unless required by applicable law or agreed to in writing, software
 *  distributed under the License is distributed on an "AS IS" BASIS,
 *  WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 *  See the License for the specific language governing permissions and
 *  limitations under the License.
 ********************************************************************************/
// THIS CODE WAS SECURITY REVIEWED BY KUDELSKI SECURITY, BUT NOT FORMALLY AUDITED

// Original license: SPDX_License_Identifier: Apache-2.0
pragma solidity ^0.8.17;

// 	MajUnsignedInt = 0
// 	MajSignedInt   = 1
// 	MajByteString  = 2
// 	MajTextString  = 3
// 	MajArray       = 4
// 	MajMap         = 5
// 	MajTag         = 6
// 	MajOther       = 7

uint8 constant MajUnsignedInt = 0;
uint8 constant MajSignedInt = 1;
uint8 constant MajByteString = 2;
uint8 constant MajTextString = 3;
uint8 constant MajArray = 4;
uint8 constant MajMap = 5;
uint8 constant MajTag = 6;
uint8 constant MajOther = 7;

uint8 constant TagTypeBigNum = 2;
uint8 constant TagTypeNegativeBigNum = 3;

uint8 constant True_Type = 21;
uint8 constant False_Type = 20;

/// @notice This library is a set a functions that allows anyone to decode cbor encoded bytes
/// @dev methods in this library try to read the data type indicated from cbor encoded data stored in bytes at a specific index
/// @dev if it successes, methods will return the read value and the new index (intial index plus read bytes)
/// @author Zondax AG
library CBORDecoder {
    /// @notice check if next value on the cbor encoded data is null
    /// @param cborData cbor encoded bytes to parse from
    /// @param byteIdx current position to read on the cbor encoded bytes
    function isNullNext(bytes memory cborData, uint byteIdx) internal pure returns (bool) {
        return cborData[byteIdx] == hex"f6";
    }

    /// @notice attempt to read a bool value
    /// @param cborData cbor encoded bytes to parse from
    /// @param byteIdx current position to read on the cbor encoded bytes
    /// @return a bool decoded from input bytes and the byte index after moving past the value
    function readBool(bytes memory cborData, uint byteIdx) internal pure returns (bool, uint) {
        uint8 maj;
        uint value;

        (maj, value, byteIdx) = parseCborHeader(cborData, byteIdx);
        require(maj == MajOther, "invalid maj (expected MajOther)");
        assert(value == True_Type || value == False_Type);

        return (value != False_Type, byteIdx);
    }

    /// @notice attempt to read the length of a fixed array
    /// @param cborData cbor encoded bytes to parse from
    /// @param byteIdx current position to read on the cbor encoded bytes
    /// @return length of the fixed array decoded from input bytes and the byte index after moving past the value
    function readFixedArray(bytes memory cborData, uint byteIdx) internal pure returns (uint, uint) {
        uint8 maj;
        uint len;

        (maj, len, byteIdx) = parseCborHeader(cborData, byteIdx);
        require(maj == MajArray, "invalid maj (expected MajArray)");

        return (len, byteIdx);
    }

    /// @notice attempt to read an arbitrary length string value
    /// @param cborData cbor encoded bytes to parse from
    /// @param byteIdx current position to read on the cbor encoded bytes
    /// @return arbitrary length string decoded from input bytes and the byte index after moving past the value
    function readString(bytes memory cborData, uint byteIdx) internal pure returns (string memory, uint) {
        uint8 maj;
        uint len;

        (maj, len, byteIdx) = parseCborHeader(cborData, byteIdx);
        require(maj == MajTextString, "invalid maj (expected MajTextString)");

        uint max_len = byteIdx + len;
        bytes memory slice = new bytes(len);
        uint slice_index = 0;
        for (uint256 i = byteIdx; i < max_len; i++) {
            slice[slice_index] = cborData[i];
            slice_index++;
        }

        return (string(slice), byteIdx + len);
    }

    /// @notice attempt to read an arbitrary byte string value
    /// @param cborData cbor encoded bytes to parse from
    /// @param byteIdx current position to read on the cbor encoded bytes
    /// @return arbitrary byte string decoded from input bytes and the byte index after moving past the value
    function readBytes(bytes memory cborData, uint byteIdx) internal pure returns (bytes memory, uint) {
        uint8 maj;
        uint len;

        (maj, len, byteIdx) = parseCborHeader(cborData, byteIdx);
        require(maj == MajTag || maj == MajByteString, "invalid maj (expected MajTag or MajByteString)");

        if (maj == MajTag) {
            (maj, len, byteIdx) = parseCborHeader(cborData, byteIdx);
            assert(maj == MajByteString);
        }

        uint max_len = byteIdx + len;
        bytes memory slice = new bytes(len);
        uint slice_index = 0;
        for (uint256 i = byteIdx; i < max_len; i++) {
            slice[slice_index] = cborData[i];
            slice_index++;
        }

        return (slice, byteIdx + len);
    }

    /// @notice attempt to read a bytes32 value
    /// @param cborData cbor encoded bytes to parse from
    /// @param byteIdx current position to read on the cbor encoded bytes
    /// @return a bytes32 decoded from input bytes and the byte index after moving past the value
    function readBytes32(bytes memory cborData, uint byteIdx) internal pure returns (bytes32, uint) {
        uint8 maj;
        uint len;

        (maj, len, byteIdx) = parseCborHeader(cborData, byteIdx);
        require(maj == MajByteString, "invalid maj (expected MajByteString)");

        uint max_len = byteIdx + len;
        bytes memory slice = new bytes(32);
        uint slice_index = 32 - len;
        for (uint256 i = byteIdx; i < max_len; i++) {
            slice[slice_index] = cborData[i];
            slice_index++;
        }

        return (bytes32(slice), byteIdx + len);
    }

    /// @notice attempt to read a uint256 value encoded per cbor specification
    /// @param cborData cbor encoded bytes to parse from
    /// @param byteIdx current position to read on the cbor encoded bytes
    /// @return an uint256 decoded from input bytes and the byte index after moving past the value
    function readUInt256(bytes memory cborData, uint byteIdx) internal pure returns (uint256, uint) {
        uint8 maj;
        uint256 value;

        (maj, value, byteIdx) = parseCborHeader(cborData, byteIdx);
        require(maj == MajTag || maj == MajUnsignedInt, "invalid maj (expected MajTag or MajUnsignedInt)");

        if (maj == MajTag) {
            require(value == TagTypeBigNum, "invalid tag (expected TagTypeBigNum)");

            uint len;
            (maj, len, byteIdx) = parseCborHeader(cborData, byteIdx);
            require(maj == MajByteString, "invalid maj (expected MajByteString)");

            require(cborData.length >= byteIdx + len, "slicing out of range");
            assembly {
                value := mload(add(cborData, add(len, byteIdx)))
            }

            return (value, byteIdx + len);
        }

        return (value, byteIdx);
    }

    /// @notice attempt to read a int256 value encoded per cbor specification
    /// @param cborData cbor encoded bytes to parse from
    /// @param byteIdx current position to read on the cbor encoded bytes
    /// @return an int256 decoded from input bytes and the byte index after moving past the value
    function readInt256(bytes memory cborData, uint byteIdx) internal pure returns (int256, uint) {
        uint8 maj;
        uint value;

        (maj, value, byteIdx) = parseCborHeader(cborData, byteIdx);
        require(maj == MajTag || maj == MajSignedInt, "invalid maj (expected MajTag or MajSignedInt)");

        if (maj == MajTag) {
            assert(value == TagTypeNegativeBigNum);

            uint len;
            (maj, len, byteIdx) = parseCborHeader(cborData, byteIdx);
            require(maj == MajByteString, "invalid maj (expected MajByteString)");

            require(cborData.length >= byteIdx + len, "slicing out of range");
            assembly {
                value := mload(add(cborData, add(len, byteIdx)))
            }

            return (int256(value), byteIdx + len);
        }

        return (int256(value), byteIdx);
    }

    /// @notice attempt to read a uint64 value
    /// @param cborData cbor encoded bytes to parse from
    /// @param byteIdx current position to read on the cbor encoded bytes
    /// @return an uint64 decoded from input bytes and the byte index after moving past the value
    function readUInt64(bytes memory cborData, uint byteIdx) internal pure returns (uint64, uint) {
        uint8 maj;
        uint value;

        (maj, value, byteIdx) = parseCborHeader(cborData, byteIdx);
        require(maj == MajUnsignedInt, "invalid maj (expected MajUnsignedInt)");

        return (uint64(value), byteIdx);
    }

    /// @notice attempt to read a uint32 value
    /// @param cborData cbor encoded bytes to parse from
    /// @param byteIdx current position to read on the cbor encoded bytes
    /// @return an uint32 decoded from input bytes and the byte index after moving past the value
    function readUInt32(bytes memory cborData, uint byteIdx) internal pure returns (uint32, uint) {
        uint8 maj;
        uint value;

        (maj, value, byteIdx) = parseCborHeader(cborData, byteIdx);
        require(maj == MajUnsignedInt, "invalid maj (expected MajUnsignedInt)");

        return (uint32(value), byteIdx);
    }

    /// @notice attempt to read a uint16 value
    /// @param cborData cbor encoded bytes to parse from
    /// @param byteIdx current position to read on the cbor encoded bytes
    /// @return an uint16 decoded from input bytes and the byte index after moving past the value
    function readUInt16(bytes memory cborData, uint byteIdx) internal pure returns (uint16, uint) {
        uint8 maj;
        uint value;

        (maj, value, byteIdx) = parseCborHeader(cborData, byteIdx);
        require(maj == MajUnsignedInt, "invalid maj (expected MajUnsignedInt)");

        return (uint16(value), byteIdx);
    }

    /// @notice attempt to read a uint8 value
    /// @param cborData cbor encoded bytes to parse from
    /// @param byteIdx current position to read on the cbor encoded bytes
    /// @return an uint8 decoded from input bytes and the byte index after moving past the value
    function readUInt8(bytes memory cborData, uint byteIdx) internal pure returns (uint8, uint) {
        uint8 maj;
        uint value;

        (maj, value, byteIdx) = parseCborHeader(cborData, byteIdx);
        require(maj == MajUnsignedInt, "invalid maj (expected MajUnsignedInt)");

        return (uint8(value), byteIdx);
    }

    /// @notice attempt to read a int64 value
    /// @param cborData cbor encoded bytes to parse from
    /// @param byteIdx current position to read on the cbor encoded bytes
    /// @return an int64 decoded from input bytes and the byte index after moving past the value
    function readInt64(bytes memory cborData, uint byteIdx) internal pure returns (int64, uint) {
        uint8 maj;
        uint value;

        (maj, value, byteIdx) = parseCborHeader(cborData, byteIdx);
        require(maj == MajSignedInt || maj == MajUnsignedInt, "invalid maj (expected MajSignedInt or MajUnsignedInt)");

        return (int64(uint64(value)), byteIdx);
    }

    /// @notice attempt to read a int32 value
    /// @param cborData cbor encoded bytes to parse from
    /// @param byteIdx current position to read on the cbor encoded bytes
    /// @return an int32 decoded from input bytes and the byte index after moving past the value
    function readInt32(bytes memory cborData, uint byteIdx) internal pure returns (int32, uint) {
        uint8 maj;
        uint value;

        (maj, value, byteIdx) = parseCborHeader(cborData, byteIdx);
        require(maj == MajSignedInt || maj == MajUnsignedInt, "invalid maj (expected MajSignedInt or MajUnsignedInt)");

        return (int32(uint32(value)), byteIdx);
    }

    /// @notice attempt to read a int16 value
    /// @param cborData cbor encoded bytes to parse from
    /// @param byteIdx current position to read on the cbor encoded bytes
    /// @return an int16 decoded from input bytes and the byte index after moving past the value
    function readInt16(bytes memory cborData, uint byteIdx) internal pure returns (int16, uint) {
        uint8 maj;
        uint value;

        (maj, value, byteIdx) = parseCborHeader(cborData, byteIdx);
        require(maj == MajSignedInt || maj == MajUnsignedInt, "invalid maj (expected MajSignedInt or MajUnsignedInt)");

        return (int16(uint16(value)), byteIdx);
    }

    /// @notice attempt to read a int8 value
    /// @param cborData cbor encoded bytes to parse from
    /// @param byteIdx current position to read on the cbor encoded bytes
    /// @return an int8 decoded from input bytes and the byte index after moving past the value
    function readInt8(bytes memory cborData, uint byteIdx) internal pure returns (int8, uint) {
        uint8 maj;
        uint value;

        (maj, value, byteIdx) = parseCborHeader(cborData, byteIdx);
        require(maj == MajSignedInt || maj == MajUnsignedInt, "invalid maj (expected MajSignedInt or MajUnsignedInt)");

        return (int8(uint8(value)), byteIdx);
    }

    /// @notice slice uint8 from bytes starting at a given index
    /// @param bs bytes to slice from
    /// @param start current position to slice from bytes
    /// @return uint8 sliced from bytes
    function sliceUInt8(bytes memory bs, uint start) internal pure returns (uint8) {
        require(bs.length >= start + 1, "slicing out of range");
        return uint8(bs[start]);
    }

    /// @notice slice uint16 from bytes starting at a given index
    /// @param bs bytes to slice from
    /// @param start current position to slice from bytes
    /// @return uint16 sliced from bytes
    function sliceUInt16(bytes memory bs, uint start) internal pure returns (uint16) {
        require(bs.length >= start + 2, "slicing out of range");
        bytes2 x;
        assembly {
            x := mload(add(bs, add(0x20, start)))
        }
        return uint16(x);
    }

    /// @notice slice uint32 from bytes starting at a given index
    /// @param bs bytes to slice from
    /// @param start current position to slice from bytes
    /// @return uint32 sliced from bytes
    function sliceUInt32(bytes memory bs, uint start) internal pure returns (uint32) {
        require(bs.length >= start + 4, "slicing out of range");
        bytes4 x;
        assembly {
            x := mload(add(bs, add(0x20, start)))
        }
        return uint32(x);
    }

    /// @notice slice uint64 from bytes starting at a given index
    /// @param bs bytes to slice from
    /// @param start current position to slice from bytes
    /// @return uint64 sliced from bytes
    function sliceUInt64(bytes memory bs, uint start) internal pure returns (uint64) {
        require(bs.length >= start + 8, "slicing out of range");
        bytes8 x;
        assembly {
            x := mload(add(bs, add(0x20, start)))
        }
        return uint64(x);
    }

    /// @notice Parse cbor header for major type and extra info.
    /// @param cbor cbor encoded bytes to parse from
    /// @param byteIndex current position to read on the cbor encoded bytes
    /// @return major type, extra info and the byte index after moving past header bytes
    function parseCborHeader(bytes memory cbor, uint byteIndex) internal pure returns (uint8, uint64, uint) {
        uint8 first = sliceUInt8(cbor, byteIndex);
        byteIndex += 1;
        uint8 maj = (first & 0xe0) >> 5;
        uint8 low = first & 0x1f;
        // We don't handle CBOR headers with extra > 27, i.e. no indefinite lengths
        require(low < 28, "cannot handle headers with extra > 27");

        // extra is lower bits
        if (low < 24) {
            return (maj, low, byteIndex);
        }

        // extra in next byte
        if (low == 24) {
            uint8 next = sliceUInt8(cbor, byteIndex);
            byteIndex += 1;
            require(next >= 24, "invalid cbor"); // otherwise this is invalid cbor
            return (maj, next, byteIndex);
        }

        // extra in next 2 bytes
        if (low == 25) {
            uint16 extra16 = sliceUInt16(cbor, byteIndex);
            byteIndex += 2;
            return (maj, extra16, byteIndex);
        }

        // extra in next 4 bytes
        if (low == 26) {
            uint32 extra32 = sliceUInt32(cbor, byteIndex);
            byteIndex += 4;
            return (maj, extra32, byteIndex);
        }

        // extra in next 8 bytes
        assert(low == 27);
        uint64 extra64 = sliceUInt64(cbor, byteIndex);
        byteIndex += 8;
        return (maj, extra64, byteIndex);
    }
}


// File @zondax/filecoin-solidity/contracts/v0.8/utils/Misc.sol@v4.0.3

/*******************************************************************************
 *   (c) 2022 Zondax AG
 *
 *  Licensed under the Apache License, Version 2.0 (the "License");
 *  you may not use this file except in compliance with the License.
 *  You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 *  Unless required by applicable law or agreed to in writing, software
 *  distributed under the License is distributed on an "AS IS" BASIS,
 *  WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 *  See the License for the specific language governing permissions and
 *  limitations under the License.
 ********************************************************************************/
// THIS CODE WAS SECURITY REVIEWED BY KUDELSKI SECURITY, BUT NOT FORMALLY AUDITED

// Original license: SPDX_License_Identifier: Apache-2.0
pragma solidity ^0.8.17;

/// @title Library containing miscellaneous functions used on the project
/// @author Zondax AG
library Misc {
    uint64 constant DAG_CBOR_CODEC = 0x71;
    uint64 constant CBOR_CODEC = 0x51;
    uint64 constant NONE_CODEC = 0x00;

    // Code taken from Openzeppelin repo
    // Link: https://github.com/OpenZeppelin/openzeppelin-contracts/blob/0320a718e8e07b1d932f5acb8ad9cec9d9eed99b/contracts/utils/math/SignedMath.sol#L37-L42
    /// @notice get the abs from a signed number
    /// @param n number to get abs from
    /// @return unsigned number
    function abs(int256 n) internal pure returns (uint256) {
        unchecked {
            // must be unchecked in order to support `n = type(int256).min`
            return uint256(n >= 0 ? n : -n);
        }
    }

    /// @notice validate if an address exists or not
    /// @dev read this article for more information https://blog.finxter.com/how-to-find-out-if-an-ethereum-address-is-a-contract/
    /// @param addr address to check
    /// @return whether the address exists or not
    function addressExists(address addr) internal view returns (bool) {
        bytes32 codehash;
        assembly {
            codehash := extcodehash(addr)
        }
        return codehash != 0x0;
    }

    /// Returns the data size required by CBOR.writeFixedNumeric
    function getPrefixSize(uint256 data_size) internal pure returns (uint256) {
        if (data_size <= 23) {
            return 1;
        } else if (data_size <= 0xFF) {
            return 2;
        } else if (data_size <= 0xFFFF) {
            return 3;
        } else if (data_size <= 0xFFFFFFFF) {
            return 5;
        }
        return 9;
    }

    function getBytesSize(bytes memory value) internal pure returns (uint256) {
        return getPrefixSize(value.length) + value.length;
    }

    function getCidSize(bytes memory value) internal pure returns (uint256) {
        return getPrefixSize(2) + value.length;
    }

    function getFilActorIdSize(CommonTypes.FilActorId value) internal pure returns (uint256) {
        uint64 val = CommonTypes.FilActorId.unwrap(value);
        return getPrefixSize(uint256(val));
    }

    function getChainEpochSize(CommonTypes.ChainEpoch value) internal pure returns (uint256) {
        int64 val = CommonTypes.ChainEpoch.unwrap(value);
        if (val >= 0) {
            return getPrefixSize(uint256(uint64(val)));
        } else {
            return getPrefixSize(uint256(uint64(-1 - val)));
        }
    }

    function getBoolSize() internal pure returns (uint256) {
        return getPrefixSize(1);
    }
}


// File @ensdomains/buffer/contracts/Buffer.sol@v0.1.1

// Original license: SPDX_License_Identifier: BSD-2-Clause
pragma solidity ^0.8.4;

/**
* @dev A library for working with mutable byte buffers in Solidity.
*
* Byte buffers are mutable and expandable, and provide a variety of primitives
* for appending to them. At any time you can fetch a bytes object containing the
* current contents of the buffer. The bytes object should not be stored between
* operations, as it may change due to resizing of the buffer.
*/
library Buffer {
    /**
    * @dev Represents a mutable buffer. Buffers have a current value (buf) and
    *      a capacity. The capacity may be longer than the current value, in
    *      which case it can be extended without the need to allocate more memory.
    */
    struct buffer {
        bytes buf;
        uint capacity;
    }

    /**
    * @dev Initializes a buffer with an initial capacity.
    * @param buf The buffer to initialize.
    * @param capacity The number of bytes of space to allocate the buffer.
    * @return The buffer, for chaining.
    */
    function init(buffer memory buf, uint capacity) internal pure returns(buffer memory) {
        if (capacity % 32 != 0) {
            capacity += 32 - (capacity % 32);
        }
        // Allocate space for the buffer data
        buf.capacity = capacity;
        assembly {
            let ptr := mload(0x40)
            mstore(buf, ptr)
            mstore(ptr, 0)
            let fpm := add(32, add(ptr, capacity))
            if lt(fpm, ptr) {
                revert(0, 0)
            }
            mstore(0x40, fpm)
        }
        return buf;
    }

    /**
    * @dev Initializes a new buffer from an existing bytes object.
    *      Changes to the buffer may mutate the original value.
    * @param b The bytes object to initialize the buffer with.
    * @return A new buffer.
    */
    function fromBytes(bytes memory b) internal pure returns(buffer memory) {
        buffer memory buf;
        buf.buf = b;
        buf.capacity = b.length;
        return buf;
    }

    function resize(buffer memory buf, uint capacity) private pure {
        bytes memory oldbuf = buf.buf;
        init(buf, capacity);
        append(buf, oldbuf);
    }

    /**
    * @dev Sets buffer length to 0.
    * @param buf The buffer to truncate.
    * @return The original buffer, for chaining..
    */
    function truncate(buffer memory buf) internal pure returns (buffer memory) {
        assembly {
            let bufptr := mload(buf)
            mstore(bufptr, 0)
        }
        return buf;
    }

    /**
    * @dev Appends len bytes of a byte string to a buffer. Resizes if doing so would exceed
    *      the capacity of the buffer.
    * @param buf The buffer to append to.
    * @param data The data to append.
    * @param len The number of bytes to copy.
    * @return The original buffer, for chaining.
    */
    function append(buffer memory buf, bytes memory data, uint len) internal pure returns(buffer memory) {
        require(len <= data.length);

        uint off = buf.buf.length;
        uint newCapacity = off + len;
        if (newCapacity > buf.capacity) {
            resize(buf, newCapacity * 2);
        }

        uint dest;
        uint src;
        assembly {
            // Memory address of the buffer data
            let bufptr := mload(buf)
            // Length of existing buffer data
            let buflen := mload(bufptr)
            // Start address = buffer address + offset + sizeof(buffer length)
            dest := add(add(bufptr, 32), off)
            // Update buffer length if we're extending it
            if gt(newCapacity, buflen) {
                mstore(bufptr, newCapacity)
            }
            src := add(data, 32)
        }

        // Copy word-length chunks while possible
        for (; len >= 32; len -= 32) {
            assembly {
                mstore(dest, mload(src))
            }
            dest += 32;
            src += 32;
        }

        // Copy remaining bytes
        unchecked {
            uint mask = (256 ** (32 - len)) - 1;
            assembly {
                let srcpart := and(mload(src), not(mask))
                let destpart := and(mload(dest), mask)
                mstore(dest, or(destpart, srcpart))
            }
        }

        return buf;
    }

    /**
    * @dev Appends a byte string to a buffer. Resizes if doing so would exceed
    *      the capacity of the buffer.
    * @param buf The buffer to append to.
    * @param data The data to append.
    * @return The original buffer, for chaining.
    */
    function append(buffer memory buf, bytes memory data) internal pure returns (buffer memory) {
        return append(buf, data, data.length);
    }

    /**
    * @dev Appends a byte to the buffer. Resizes if doing so would exceed the
    *      capacity of the buffer.
    * @param buf The buffer to append to.
    * @param data The data to append.
    * @return The original buffer, for chaining.
    */
    function appendUint8(buffer memory buf, uint8 data) internal pure returns(buffer memory) {
        uint off = buf.buf.length;
        uint offPlusOne = off + 1;
        if (off >= buf.capacity) {
            resize(buf, offPlusOne * 2);
        }

        assembly {
            // Memory address of the buffer data
            let bufptr := mload(buf)
            // Address = buffer address + sizeof(buffer length) + off
            let dest := add(add(bufptr, off), 32)
            mstore8(dest, data)
            // Update buffer length if we extended it
            if gt(offPlusOne, mload(bufptr)) {
                mstore(bufptr, offPlusOne)
            }
        }

        return buf;
    }

    /**
    * @dev Appends len bytes of bytes32 to a buffer. Resizes if doing so would
    *      exceed the capacity of the buffer.
    * @param buf The buffer to append to.
    * @param data The data to append.
    * @param len The number of bytes to write (left-aligned).
    * @return The original buffer, for chaining.
    */
    function append(buffer memory buf, bytes32 data, uint len) private pure returns(buffer memory) {
        uint off = buf.buf.length;
        uint newCapacity = len + off;
        if (newCapacity > buf.capacity) {
            resize(buf, newCapacity * 2);
        }

        unchecked {
            uint mask = (256 ** len) - 1;
            // Right-align data
            data = data >> (8 * (32 - len));
            assembly {
                // Memory address of the buffer data
                let bufptr := mload(buf)
                // Address = buffer address + sizeof(buffer length) + newCapacity
                let dest := add(bufptr, newCapacity)
                mstore(dest, or(and(mload(dest), not(mask)), data))
                // Update buffer length if we extended it
                if gt(newCapacity, mload(bufptr)) {
                    mstore(bufptr, newCapacity)
                }
            }
        }
        return buf;
    }

    /**
    * @dev Appends a bytes20 to the buffer. Resizes if doing so would exceed
    *      the capacity of the buffer.
    * @param buf The buffer to append to.
    * @param data The data to append.
    * @return The original buffer, for chhaining.
    */
    function appendBytes20(buffer memory buf, bytes20 data) internal pure returns (buffer memory) {
        return append(buf, bytes32(data), 20);
    }

    /**
    * @dev Appends a bytes32 to the buffer. Resizes if doing so would exceed
    *      the capacity of the buffer.
    * @param buf The buffer to append to.
    * @param data The data to append.
    * @return The original buffer, for chaining.
    */
    function appendBytes32(buffer memory buf, bytes32 data) internal pure returns (buffer memory) {
        return append(buf, data, 32);
    }

    /**
     * @dev Appends a byte to the end of the buffer. Resizes if doing so would
     *      exceed the capacity of the buffer.
     * @param buf The buffer to append to.
     * @param data The data to append.
     * @param len The number of bytes to write (right-aligned).
     * @return The original buffer.
     */
    function appendInt(buffer memory buf, uint data, uint len) internal pure returns(buffer memory) {
        uint off = buf.buf.length;
        uint newCapacity = len + off;
        if (newCapacity > buf.capacity) {
            resize(buf, newCapacity * 2);
        }

        uint mask = (256 ** len) - 1;
        assembly {
            // Memory address of the buffer data
            let bufptr := mload(buf)
            // Address = buffer address + sizeof(buffer length) + newCapacity
            let dest := add(bufptr, newCapacity)
            mstore(dest, or(and(mload(dest), not(mask)), data))
            // Update buffer length if we extended it
            if gt(newCapacity, mload(bufptr)) {
                mstore(bufptr, newCapacity)
            }
        }
        return buf;
    }
}


// File solidity-cborutils/contracts/CBOR.sol@v2.0.0

// Original license: SPDX_License_Identifier: MIT
pragma solidity ^0.8.4;

/**
* @dev A library for populating CBOR encoded payload in Solidity.
*
* https://datatracker.ietf.org/doc/html/rfc7049
*
* The library offers various write* and start* methods to encode values of different types.
* The resulted buffer can be obtained with data() method.
* Encoding of primitive types is staightforward, whereas encoding of sequences can result
* in an invalid CBOR if start/write/end flow is violated.
* For the purpose of gas saving, the library does not verify start/write/end flow internally,
* except for nested start/end pairs.
*/

library CBOR {
    using Buffer for Buffer.buffer;

    struct CBORBuffer {
        Buffer.buffer buf;
        uint256 depth;
    }

    uint8 private constant MAJOR_TYPE_INT = 0;
    uint8 private constant MAJOR_TYPE_NEGATIVE_INT = 1;
    uint8 private constant MAJOR_TYPE_BYTES = 2;
    uint8 private constant MAJOR_TYPE_STRING = 3;
    uint8 private constant MAJOR_TYPE_ARRAY = 4;
    uint8 private constant MAJOR_TYPE_MAP = 5;
    uint8 private constant MAJOR_TYPE_TAG = 6;
    uint8 private constant MAJOR_TYPE_CONTENT_FREE = 7;

    uint8 private constant TAG_TYPE_BIGNUM = 2;
    uint8 private constant TAG_TYPE_NEGATIVE_BIGNUM = 3;

    uint8 private constant CBOR_FALSE = 20;
    uint8 private constant CBOR_TRUE = 21;
    uint8 private constant CBOR_NULL = 22;
    uint8 private constant CBOR_UNDEFINED = 23;

    function create(uint256 capacity) internal pure returns(CBORBuffer memory cbor) {
        Buffer.init(cbor.buf, capacity);
        cbor.depth = 0;
        return cbor;
    }

    function data(CBORBuffer memory buf) internal pure returns(bytes memory) {
        require(buf.depth == 0, "Invalid CBOR");
        return buf.buf.buf;
    }

    function writeUInt256(CBORBuffer memory buf, uint256 value) internal pure {
        buf.buf.appendUint8(uint8((MAJOR_TYPE_TAG << 5) | TAG_TYPE_BIGNUM));
        writeBytes(buf, abi.encode(value));
    }

    function writeInt256(CBORBuffer memory buf, int256 value) internal pure {
        if (value < 0) {
            buf.buf.appendUint8(
                uint8((MAJOR_TYPE_TAG << 5) | TAG_TYPE_NEGATIVE_BIGNUM)
            );
            writeBytes(buf, abi.encode(uint256(-1 - value)));
        } else {
            writeUInt256(buf, uint256(value));
        }
    }

    function writeUInt64(CBORBuffer memory buf, uint64 value) internal pure {
        writeFixedNumeric(buf, MAJOR_TYPE_INT, value);
    }

    function writeInt64(CBORBuffer memory buf, int64 value) internal pure {
        if(value >= 0) {
            writeFixedNumeric(buf, MAJOR_TYPE_INT, uint64(value));
        } else{
            writeFixedNumeric(buf, MAJOR_TYPE_NEGATIVE_INT, uint64(-1 - value));
        }
    }

    function writeBytes(CBORBuffer memory buf, bytes memory value) internal pure {
        writeFixedNumeric(buf, MAJOR_TYPE_BYTES, uint64(value.length));
        buf.buf.append(value);
    }

    function writeString(CBORBuffer memory buf, string memory value) internal pure {
        writeFixedNumeric(buf, MAJOR_TYPE_STRING, uint64(bytes(value).length));
        buf.buf.append(bytes(value));
    }

    function writeBool(CBORBuffer memory buf, bool value) internal pure {
        writeContentFree(buf, value ? CBOR_TRUE : CBOR_FALSE);
    }

    function writeNull(CBORBuffer memory buf) internal pure {
        writeContentFree(buf, CBOR_NULL);
    }

    function writeUndefined(CBORBuffer memory buf) internal pure {
        writeContentFree(buf, CBOR_UNDEFINED);
    }

    function startArray(CBORBuffer memory buf) internal pure {
        writeIndefiniteLengthType(buf, MAJOR_TYPE_ARRAY);
        buf.depth += 1;
    }

    function startFixedArray(CBORBuffer memory buf, uint64 length) internal pure {
        writeDefiniteLengthType(buf, MAJOR_TYPE_ARRAY, length);
    }

    function startMap(CBORBuffer memory buf) internal pure {
        writeIndefiniteLengthType(buf, MAJOR_TYPE_MAP);
        buf.depth += 1;
    }

    function startFixedMap(CBORBuffer memory buf, uint64 length) internal pure {
        writeDefiniteLengthType(buf, MAJOR_TYPE_MAP, length);
    }

    function endSequence(CBORBuffer memory buf) internal pure {
        writeIndefiniteLengthType(buf, MAJOR_TYPE_CONTENT_FREE);
        buf.depth -= 1;
    }

    function writeKVString(CBORBuffer memory buf, string memory key, string memory value) internal pure {
        writeString(buf, key);
        writeString(buf, value);
    }

    function writeKVBytes(CBORBuffer memory buf, string memory key, bytes memory value) internal pure {
        writeString(buf, key);
        writeBytes(buf, value);
    }

    function writeKVUInt256(CBORBuffer memory buf, string memory key, uint256 value) internal pure {
        writeString(buf, key);
        writeUInt256(buf, value);
    }

    function writeKVInt256(CBORBuffer memory buf, string memory key, int256 value) internal pure {
        writeString(buf, key);
        writeInt256(buf, value);
    }

    function writeKVUInt64(CBORBuffer memory buf, string memory key, uint64 value) internal pure {
        writeString(buf, key);
        writeUInt64(buf, value);
    }

    function writeKVInt64(CBORBuffer memory buf, string memory key, int64 value) internal pure {
        writeString(buf, key);
        writeInt64(buf, value);
    }

    function writeKVBool(CBORBuffer memory buf, string memory key, bool value) internal pure {
        writeString(buf, key);
        writeBool(buf, value);
    }

    function writeKVNull(CBORBuffer memory buf, string memory key) internal pure {
        writeString(buf, key);
        writeNull(buf);
    }

    function writeKVUndefined(CBORBuffer memory buf, string memory key) internal pure {
        writeString(buf, key);
        writeUndefined(buf);
    }

    function writeKVMap(CBORBuffer memory buf, string memory key) internal pure {
        writeString(buf, key);
        startMap(buf);
    }

    function writeKVArray(CBORBuffer memory buf, string memory key) internal pure {
        writeString(buf, key);
        startArray(buf);
    }

    function writeFixedNumeric(
        CBORBuffer memory buf,
        uint8 major,
        uint64 value
    ) private pure {
        if (value <= 23) {
            buf.buf.appendUint8(uint8((major << 5) | value));
        } else if (value <= 0xFF) {
            buf.buf.appendUint8(uint8((major << 5) | 24));
            buf.buf.appendInt(value, 1);
        } else if (value <= 0xFFFF) {
            buf.buf.appendUint8(uint8((major << 5) | 25));
            buf.buf.appendInt(value, 2);
        } else if (value <= 0xFFFFFFFF) {
            buf.buf.appendUint8(uint8((major << 5) | 26));
            buf.buf.appendInt(value, 4);
        } else {
            buf.buf.appendUint8(uint8((major << 5) | 27));
            buf.buf.appendInt(value, 8);
        }
    }

    function writeIndefiniteLengthType(CBORBuffer memory buf, uint8 major)
        private
        pure
    {
        buf.buf.appendUint8(uint8((major << 5) | 31));
    }

    function writeDefiniteLengthType(CBORBuffer memory buf, uint8 major, uint64 length)
        private
        pure
    {
        writeFixedNumeric(buf, major, length);
    }

    function writeContentFree(CBORBuffer memory buf, uint8 value) private pure {
        buf.buf.appendUint8(uint8((MAJOR_TYPE_CONTENT_FREE << 5) | value));
    }
}


// File @zondax/filecoin-solidity/contracts/v0.8/cbor/BytesCbor.sol@v4.0.3

/*******************************************************************************
 *   (c) 2022 Zondax AG
 *
 *  Licensed under the Apache License, Version 2.0 (the "License");
 *  you may not use this file except in compliance with the License.
 *  You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 *  Unless required by applicable law or agreed to in writing, software
 *  distributed under the License is distributed on an "AS IS" BASIS,
 *  WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 *  See the License for the specific language governing permissions and
 *  limitations under the License.
 ********************************************************************************/
//
// THIS CODE WAS SECURITY REVIEWED BY KUDELSKI SECURITY, BUT NOT FORMALLY AUDITED

// Original license: SPDX_License_Identifier: Apache-2.0
pragma solidity ^0.8.17;


/// @title This library is a set of functions meant to handle CBOR serialization and deserialization for bytes
/// @author Zondax AG
library BytesCBOR {
    using CBOR for CBOR.CBORBuffer;
    using CBORDecoder for bytes;
    using BigIntCBOR for bytes;

    /// @notice serialize raw bytes as cbor bytes string encoded
    /// @param data raw data in bytes
    /// @return encoded cbor bytes
    function serializeBytes(bytes memory data) internal pure returns (bytes memory) {
        uint256 capacity = Misc.getBytesSize(data);

        CBOR.CBORBuffer memory buf = CBOR.create(capacity);

        buf.writeBytes(data);

        return buf.data();
    }

    /// @notice serialize raw address (in bytes) as cbor bytes string encoded (how an address is passed to filecoin actors)
    /// @param addr raw address in bytes
    /// @return encoded address as cbor bytes
    function serializeAddress(bytes memory addr) internal pure returns (bytes memory) {
        return serializeBytes(addr);
    }

    /// @notice encoded null value as cbor
    /// @return cbor encoded null
    function serializeNull() internal pure returns (bytes memory) {
        CBOR.CBORBuffer memory buf = CBOR.create(1);

        buf.writeNull();

        return buf.data();
    }

    /// @notice deserialize cbor encoded filecoin address to bytes
    /// @param ret cbor encoded filecoin address
    /// @return raw bytes representing a filecoin address
    function deserializeAddress(bytes memory ret) internal pure returns (bytes memory) {
        bytes memory addr;
        uint byteIdx = 0;

        (addr, byteIdx) = ret.readBytes(byteIdx);

        return addr;
    }

    /// @notice deserialize cbor encoded string
    /// @param ret cbor encoded string (in bytes)
    /// @return decoded string
    function deserializeString(bytes memory ret) internal pure returns (string memory) {
        string memory response;
        uint byteIdx = 0;

        (response, byteIdx) = ret.readString(byteIdx);

        return response;
    }

    /// @notice deserialize cbor encoded bool
    /// @param ret cbor encoded bool (in bytes)
    /// @return decoded bool
    function deserializeBool(bytes memory ret) internal pure returns (bool) {
        bool response;
        uint byteIdx = 0;

        (response, byteIdx) = ret.readBool(byteIdx);

        return response;
    }

    /// @notice deserialize cbor encoded BigInt
    /// @param ret cbor encoded BigInt (in bytes)
    /// @return decoded BigInt
    /// @dev BigInts are cbor encoded as bytes string first. That is why it unwraps the cbor encoded bytes first, and then parse the result into BigInt
    function deserializeBytesBigInt(bytes memory ret) internal pure returns (CommonTypes.BigInt memory) {
        bytes memory tmp;
        uint byteIdx = 0;

        if (ret.length > 0) {
            (tmp, byteIdx) = ret.readBytes(byteIdx);
            if (tmp.length > 0) {
                return tmp.deserializeBigInt();
            }
        }

        return CommonTypes.BigInt(new bytes(0), false);
    }

    /// @notice deserialize cbor encoded uint64
    /// @param rawResp cbor encoded uint64 (in bytes)
    /// @return decoded uint64
    function deserializeUint64(bytes memory rawResp) internal pure returns (uint64) {
        uint byteIdx = 0;
        uint64 value;

        (value, byteIdx) = rawResp.readUInt64(byteIdx);
        return value;
    }

    /// @notice deserialize cbor encoded int64
    /// @param rawResp cbor encoded int64 (in bytes)
    /// @return decoded int64
    function deserializeInt64(bytes memory rawResp) internal pure returns (int64) {
        uint byteIdx = 0;
        int64 value;

        (value, byteIdx) = rawResp.readInt64(byteIdx);
        return value;
    }
}


// File @zondax/filecoin-solidity/contracts/v0.8/cbor/FilecoinCbor.sol@v4.0.3

/*******************************************************************************
 *   (c) 2022 Zondax AG
 *
 *  Licensed under the Apache License, Version 2.0 (the "License");
 *  you may not use this file except in compliance with the License.
 *  You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 *  Unless required by applicable law or agreed to in writing, software
 *  distributed under the License is distributed on an "AS IS" BASIS,
 *  WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 *  See the License for the specific language governing permissions and
 *  limitations under the License.
 ********************************************************************************/
//
// THIS CODE WAS SECURITY REVIEWED BY KUDELSKI SECURITY, BUT NOT FORMALLY AUDITED

// Original license: SPDX_License_Identifier: Apache-2.0
pragma solidity ^0.8.17;



/// @title This library is a set of functions meant to handle CBOR serialization and deserialization for general data types on the filecoin network.
/// @author Zondax AG
library FilecoinCBOR {
    using Buffer for Buffer.buffer;
    using CBOR for CBOR.CBORBuffer;
    using CBORDecoder for *;
    using BigIntCBOR for *;

    uint8 private constant MAJOR_TYPE_TAG = 6;
    uint8 private constant TAG_TYPE_CID_CODE = 42;
    uint8 private constant PAYLOAD_LEN_8_BITS = 24;

    /// @notice Write a CID into a CBOR buffer.
    /// @dev The CBOR major will be 6 (type 'tag') and the tag type value is 42, as per CBOR tag assignments.
    /// @dev https://www.iana.org/assignments/cbor-tags/cbor-tags.xhtml
    /// @param buf buffer containing the actual CBOR serialization process
    /// @param value CID value to serialize as CBOR
    function writeCid(CBOR.CBORBuffer memory buf, bytes memory value) internal pure {
        buf.buf.appendUint8(uint8(((MAJOR_TYPE_TAG << 5) | PAYLOAD_LEN_8_BITS)));
        buf.buf.appendUint8(TAG_TYPE_CID_CODE);
        // See https://ipld.io/specs/codecs/dag-cbor/spec/#links for explanation on 0x00 prefix.
        buf.writeBytes(bytes.concat(hex'00', value));
    }

    function readCid(bytes memory cborData, uint byteIdx) internal pure returns (CommonTypes.Cid memory, uint) {
        uint8 maj;
        uint value;

        (maj, value, byteIdx) = cborData.parseCborHeader(byteIdx);
        require(maj == MAJOR_TYPE_TAG, "expected major type tag when parsing cid");
        require(value == TAG_TYPE_CID_CODE, "expected tag 42 when parsing cid");

        bytes memory raw;
        (raw, byteIdx) = cborData.readBytes(byteIdx);
        require(raw[0] == 0x00, "expected first byte to be 0 when parsing cid");

        // Pop off the first byte, which corresponds to the historical multibase 0x00 byte.
        // https://ipld.io/specs/codecs/dag-cbor/spec/#links
        CommonTypes.Cid memory ret;
        ret.data = new bytes(raw.length - 1);
        for (uint256 i = 1; i < raw.length; i++) {
            ret.data[i-1] = raw[i];
        }

        return (ret, byteIdx);
    }

    /// @notice serialize filecoin address to cbor encoded
    /// @param addr filecoin address to serialize
    /// @return cbor serialized data as bytes
    function serializeAddress(CommonTypes.FilAddress memory addr) internal pure returns (bytes memory) {
        uint256 capacity = Misc.getBytesSize(addr.data);
        CBOR.CBORBuffer memory buf = CBOR.create(capacity);

        buf.writeBytes(addr.data);

        return buf.data();
    }

    /// @notice serialize a BigInt value wrapped in a cbor fixed array.
    /// @param value BigInt to serialize as cbor inside an
    /// @return cbor serialized data as bytes
    function serializeArrayBigInt(CommonTypes.BigInt memory value) internal pure returns (bytes memory) {
        uint256 capacity = 0;
        bytes memory valueBigInt = value.serializeBigInt();

        capacity += Misc.getPrefixSize(1);
        capacity += Misc.getBytesSize(valueBigInt);
        CBOR.CBORBuffer memory buf = CBOR.create(capacity);

        buf.startFixedArray(1);
        buf.writeBytes(value.serializeBigInt());

        return buf.data();
    }

    /// @notice serialize a FilAddress value wrapped in a cbor fixed array.
    /// @param addr FilAddress to serialize as cbor inside an
    /// @return cbor serialized data as bytes
    function serializeArrayFilAddress(CommonTypes.FilAddress memory addr) internal pure returns (bytes memory) {
        uint256 capacity = 0;

        capacity += Misc.getPrefixSize(1);
        capacity += Misc.getBytesSize(addr.data);
        CBOR.CBORBuffer memory buf = CBOR.create(capacity);

        buf.startFixedArray(1);
        buf.writeBytes(addr.data);

        return buf.data();
    }

    /// @notice deserialize a FilAddress wrapped on a cbor fixed array coming from a actor call
    /// @param rawResp cbor encoded response
    /// @return ret new instance of FilAddress created based on parsed data
    function deserializeArrayFilAddress(bytes memory rawResp) internal pure returns (CommonTypes.FilAddress memory ret) {
        uint byteIdx = 0;
        uint len;

        (len, byteIdx) = rawResp.readFixedArray(byteIdx);
        require(len == 1, "Wrong numbers of parameters (should find 1)");

        (ret.data, byteIdx) = rawResp.readBytes(byteIdx);

        return ret;
    }

    /// @notice deserialize a BigInt wrapped on a cbor fixed array coming from a actor call
    /// @param rawResp cbor encoded response
    /// @return ret new instance of BigInt created based on parsed data
    function deserializeArrayBigInt(bytes memory rawResp) internal pure returns (CommonTypes.BigInt memory) {
        uint byteIdx = 0;
        uint len;
        bytes memory tmp;

        (len, byteIdx) = rawResp.readFixedArray(byteIdx);
        assert(len == 1);

        (tmp, byteIdx) = rawResp.readBytes(byteIdx);
        return tmp.deserializeBigInt();
    }

    /// @notice serialize UniversalReceiverParams struct to cbor in order to pass as arguments to an actor
    /// @param params UniversalReceiverParams to serialize as cbor
    /// @return cbor serialized data as bytes
    function serializeUniversalReceiverParams(CommonTypes.UniversalReceiverParams memory params) internal pure returns (bytes memory) {
        uint256 capacity = 0;

        capacity += Misc.getPrefixSize(2);
        capacity += Misc.getPrefixSize(params.type_);
        capacity += Misc.getBytesSize(params.payload);
        CBOR.CBORBuffer memory buf = CBOR.create(capacity);

        buf.startFixedArray(2);
        buf.writeUInt64(params.type_);
        buf.writeBytes(params.payload);

        return buf.data();
    }

    /// @notice deserialize UniversalReceiverParams cbor to struct when receiving a message
    /// @param rawResp cbor encoded response
    /// @return ret new instance of UniversalReceiverParams created based on parsed data
    function deserializeUniversalReceiverParams(bytes memory rawResp) internal pure returns (CommonTypes.UniversalReceiverParams memory ret) {
        uint byteIdx = 0;
        uint len;

        (len, byteIdx) = rawResp.readFixedArray(byteIdx);
        require(len == 2, "Wrong numbers of parameters (should find 2)");

        (ret.type_, byteIdx) = rawResp.readUInt32(byteIdx);
        (ret.payload, byteIdx) = rawResp.readBytes(byteIdx);
    }

    /// @notice attempt to read a FilActorId value
    /// @param rawResp cbor encoded bytes to parse from
    /// @param byteIdx current position to read on the cbor encoded bytes
    /// @return a FilActorId decoded from input bytes and the byte index after moving past the value
    function readFilActorId(bytes memory rawResp, uint byteIdx) internal pure returns (CommonTypes.FilActorId, uint) {
        uint64 tmp = 0;

        (tmp, byteIdx) = rawResp.readUInt64(byteIdx);
        return (CommonTypes.FilActorId.wrap(tmp), byteIdx);
    }

    /// @notice write FilActorId into a cbor buffer
    /// @dev FilActorId is just wrapping a uint64
    /// @param buf buffer containing the actual cbor serialization process
    /// @param id FilActorId to serialize as cbor
    function writeFilActorId(CBOR.CBORBuffer memory buf, CommonTypes.FilActorId id) internal pure {
        buf.writeUInt64(CommonTypes.FilActorId.unwrap(id));
    }

    /// @notice attempt to read a ChainEpoch value
    /// @param rawResp cbor encoded bytes to parse from
    /// @param byteIdx current position to read on the cbor encoded bytes
    /// @return a ChainEpoch decoded from input bytes and the byte index after moving past the value
    function readChainEpoch(bytes memory rawResp, uint byteIdx) internal pure returns (CommonTypes.ChainEpoch, uint) {
        int64 tmp = 0;

        (tmp, byteIdx) = rawResp.readInt64(byteIdx);
        return (CommonTypes.ChainEpoch.wrap(tmp), byteIdx);
    }

    /// @notice write ChainEpoch into a cbor buffer
    /// @dev ChainEpoch is just wrapping a int64
    /// @param buf buffer containing the actual cbor serialization process
    /// @param id ChainEpoch to serialize as cbor
    function writeChainEpoch(CBOR.CBORBuffer memory buf, CommonTypes.ChainEpoch id) internal pure {
        buf.writeInt64(CommonTypes.ChainEpoch.unwrap(id));
    }

    /// @notice write DealLabel into a cbor buffer
    /// @param buf buffer containing the actual cbor serialization process
    /// @param label DealLabel to serialize as cbor
    function writeDealLabel(CBOR.CBORBuffer memory buf, CommonTypes.DealLabel memory label) internal pure {
        label.isString ? buf.writeString(string(label.data)) : buf.writeBytes(label.data);
    }

    /// @notice deserialize DealLabel cbor to struct when receiving a message
    /// @param rawResp cbor encoded response
    /// @return ret new instance of DealLabel created based on parsed data
    function deserializeDealLabel(bytes memory rawResp) internal pure returns (CommonTypes.DealLabel memory) {
        uint byteIdx = 0;
        CommonTypes.DealLabel memory label;

        (label, byteIdx) = readDealLabel(rawResp, byteIdx);
        return label;
    }

    /// @notice attempt to read a DealLabel value
    /// @param rawResp cbor encoded bytes to parse from
    /// @param byteIdx current position to read on the cbor encoded bytes
    /// @return a DealLabel decoded from input bytes and the byte index after moving past the value
    function readDealLabel(bytes memory rawResp, uint byteIdx) internal pure returns (CommonTypes.DealLabel memory, uint) {
        uint8 maj;
        uint len;

        (maj, len, byteIdx) = CBORDecoder.parseCborHeader(rawResp, byteIdx);
        require(maj == MajByteString || maj == MajTextString, "invalid maj (expected MajByteString or MajTextString)");

        uint max_len = byteIdx + len;
        bytes memory slice = new bytes(len);
        uint slice_index = 0;
        for (uint256 i = byteIdx; i < max_len; i++) {
            slice[slice_index] = rawResp[i];
            slice_index++;
        }

        return (CommonTypes.DealLabel(slice, maj == MajTextString), byteIdx + len);
    }
}


// File @zondax/filecoin-solidity/contracts/v0.8/types/MarketTypes.sol@v4.0.3

/*******************************************************************************
 *   (c) 2022 Zondax AG
 *
 *  Licensed under the Apache License, Version 2.0 (the "License");
 *  you may not use this file except in compliance with the License.
 *  You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 *  Unless required by applicable law or agreed to in writing, software
 *  distributed under the License is distributed on an "AS IS" BASIS,
 *  WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 *  See the License for the specific language governing permissions and
 *  limitations under the License.
 ********************************************************************************/
//
// THIS CODE WAS SECURITY REVIEWED BY KUDELSKI SECURITY, BUT NOT FORMALLY AUDITED

// Original license: SPDX_License_Identifier: Apache-2.0
pragma solidity ^0.8.17;


/// @title Filecoin market actor types for Solidity.
/// @author Zondax AG
library MarketTypes {
    CommonTypes.FilActorId constant ActorID = CommonTypes.FilActorId.wrap(5);
    uint constant AddBalanceMethodNum = 822473126;
    uint constant WithdrawBalanceMethodNum = 2280458852;
    uint constant GetBalanceMethodNum = 726108461;
    uint constant GetDealDataCommitmentMethodNum = 1157985802;
    uint constant GetDealClientMethodNum = 128053329;
    uint constant GetDealProviderMethodNum = 935081690;
    uint constant GetDealLabelMethodNum = 46363526;
    uint constant GetDealTermMethodNum = 163777312;
    uint constant GetDealTotalPriceMethodNum = 4287162428;
    uint constant GetDealClientCollateralMethodNum = 200567895;
    uint constant GetDealProviderCollateralMethodNum = 2986712137;
    uint constant GetDealVerifiedMethodNum = 2627389465;
    uint constant GetDealActivationMethodNum = 2567238399;
    uint constant PublishStorageDealsMethodNum = 2236929350;

    /// @param provider_or_client the address of provider or client.
    /// @param tokenAmount the token amount to withdraw.
    struct WithdrawBalanceParams {
        CommonTypes.FilAddress provider_or_client;
        CommonTypes.BigInt tokenAmount;
    }

    /// @param balance the escrow balance for this address.
    /// @param locked the escrow locked amount for this address.
    struct GetBalanceReturn {
        CommonTypes.BigInt balance;
        CommonTypes.BigInt locked;
    }

    /// @param data the data commitment of this deal.
    /// @param size the size of this deal.
    struct GetDealDataCommitmentReturn {
        bytes data;
        uint64 size;
    }

    /// @param start the chain epoch to start the deal.
    /// @param endthe chain epoch to end the deal.
    struct GetDealTermReturn {
        CommonTypes.ChainEpoch start;
        CommonTypes.ChainEpoch end;
    }

    /// @param activated Epoch at which the deal was activated, or -1.
    /// @param terminated Epoch at which the deal was terminated abnormally, or -1.
    struct GetDealActivationReturn {
        CommonTypes.ChainEpoch activated;
        CommonTypes.ChainEpoch terminated;
    }

    /// @param deals list of deal proposals signed by a client
    struct PublishStorageDealsParams {
        ClientDealProposal[] deals;
    }

    /// @param ids returned storage deal IDs.
    /// @param valid_deals represent all the valid deals.
    struct PublishStorageDealsReturn {
        uint64[] ids;
        bytes valid_deals;
    }

    /// @param piece_cid PieceCID.
    /// @param piece_size the size of the piece.
    /// @param verified_deal if the deal is verified or not.
    /// @param client the address of the storage client.
    /// @param provider the address of the storage provider.
    /// @param label any label that client choose for the deal.
    /// @param start_epoch the chain epoch to start the deal.
    /// @param end_epoch the chain epoch to end the deal.
    /// @param storage_price_per_epoch the token amount to pay to provider per epoch.
    /// @param provider_collateral the token amount as collateral paid by the provider.
    /// @param client_collateral the token amount as collateral paid by the client.
    struct DealProposal {
        CommonTypes.Cid piece_cid;
        uint64 piece_size;
        bool verified_deal;
        CommonTypes.FilAddress client;
        CommonTypes.FilAddress provider;
        CommonTypes.DealLabel label;
        CommonTypes.ChainEpoch start_epoch;
        CommonTypes.ChainEpoch end_epoch;
        CommonTypes.BigInt storage_price_per_epoch;
        CommonTypes.BigInt provider_collateral;
        CommonTypes.BigInt client_collateral;
    }

    /// @param proposal Proposal
    /// @param client_signature the signature signed by the client.
    struct ClientDealProposal {
        DealProposal proposal;
        bytes client_signature;
    }

    struct MarketDealNotifyParams {
        bytes dealProposal;
        uint64 dealId;
    }
}


// File @zondax/filecoin-solidity/contracts/v0.8/utils/Leb128.sol@v4.0.3

/*******************************************************************************
 *   (c) 2023 Zondax AG
 *
 *  Licensed under the Apache License, Version 2.0 (the "License");
 *  you may not use this file except in compliance with the License.
 *  You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 *  Unless required by applicable law or agreed to in writing, software
 *  distributed under the License is distributed on an "AS IS" BASIS,
 *  WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 *  See the License for the specific language governing permissions and
 *  limitations under the License.
 ********************************************************************************/
// THIS CODE WAS SECURITY REVIEWED BY KUDELSKI SECURITY, BUT NOT FORMALLY AUDITED

// Original license: SPDX_License_Identifier: Apache-2.0
pragma solidity ^0.8.17;

/// @notice This library implement the leb128
/// @author Zondax AG
library Leb128 {
    using Buffer for Buffer.buffer;

    /// @notice encode a unsigned integer 64bits into bytes
    /// @param value the actor ID to encode
    /// @return result return the value in bytes
    function encodeUnsignedLeb128FromUInt64(uint64 value) internal pure returns (Buffer.buffer memory result) {
        while (true) {
            uint64 byte_ = value & 0x7f;
            value >>= 7;
            if (value == 0) {
                result.appendUint8(uint8(byte_));
                return result;
            }
            result.appendUint8(uint8(byte_ | 0x80));
        }
    }
}


// File @zondax/filecoin-solidity/contracts/v0.8/utils/FilAddresses.sol@v4.0.3

/*******************************************************************************
 *   (c) 2022 Zondax AG
 *
 *  Licensed under the Apache License, Version 2.0 (the "License");
 *  you may not use this file except in compliance with the License.
 *  You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 *  Unless required by applicable law or agreed to in writing, software
 *  distributed under the License is distributed on an "AS IS" BASIS,
 *  WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 *  See the License for the specific language governing permissions and
 *  limitations under the License.
 ********************************************************************************/
// THIS CODE WAS SECURITY REVIEWED BY KUDELSKI SECURITY, BUT NOT FORMALLY AUDITED

// Original license: SPDX_License_Identifier: Apache-2.0
pragma solidity ^0.8.17;



/// @notice This library is a set a functions that allows to handle filecoin addresses conversions and validations
/// @author Zondax AG
library FilAddresses {
    using Buffer for Buffer.buffer;

    error InvalidAddress();

    /// @notice allow to get a FilAddress from an eth address
    /// @param addr eth address to convert
    /// @return new filecoin address
    function fromEthAddress(address addr) internal pure returns (CommonTypes.FilAddress memory) {
        return CommonTypes.FilAddress(abi.encodePacked(hex"040a", addr));
    }

    /// @notice allow to create a Filecoin address from an actorID
    /// @param actorID uint64 actorID
    /// @return address filecoin address
    function fromActorID(uint64 actorID) internal pure returns (CommonTypes.FilAddress memory) {
        Buffer.buffer memory result = Leb128.encodeUnsignedLeb128FromUInt64(actorID);
        return CommonTypes.FilAddress(abi.encodePacked(hex"00", result.buf));
    }

    /// @notice allow to create a Filecoin address from bytes
    /// @param data address in bytes format
    /// @return filecoin address
    function fromBytes(bytes memory data) internal pure returns (CommonTypes.FilAddress memory) {
        CommonTypes.FilAddress memory newAddr = CommonTypes.FilAddress(data);
        if (!validate(newAddr)) {
            revert InvalidAddress();
        }

        return newAddr;
    }

    /// @notice allow to validate if an address is valid or not
    /// @dev we are only validating known address types. If the type is not known, the default value is true
    /// @param addr the filecoin address to validate
    /// @return whether the address is valid or not
    function validate(CommonTypes.FilAddress memory addr) internal pure returns (bool) {
        if (addr.data[0] == 0x00) {
            return addr.data.length <= 10;
        } else if (addr.data[0] == 0x01 || addr.data[0] == 0x02) {
            return addr.data.length == 21;
        } else if (addr.data[0] == 0x03) {
            return addr.data.length == 49;
        } else if (addr.data[0] == 0x04) {
            return addr.data.length <= 64;
        }

        return addr.data.length <= 256;
    }
}


// File @zondax/filecoin-solidity/contracts/v0.8/cbor/MarketCbor.sol@v4.0.3

/*******************************************************************************
 *   (c) 2022 Zondax AG
 *
 *  Licensed under the Apache License, Version 2.0 (the "License");
 *  you may not use this file except in compliance with the License.
 *  You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 *  Unless required by applicable law or agreed to in writing, software
 *  distributed under the License is distributed on an "AS IS" BASIS,
 *  WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 *  See the License for the specific language governing permissions and
 *  limitations under the License.
 ********************************************************************************/
//
// THIS CODE WAS SECURITY REVIEWED BY KUDELSKI SECURITY, BUT NOT FORMALLY AUDITED

// Original license: SPDX_License_Identifier: Apache-2.0
pragma solidity ^0.8.17;






/// @title This library is a set of functions meant to handle CBOR parameters serialization and return values deserialization for Market actor exported methods.
/// @author Zondax AG
library MarketCBOR {
    using CBOR for CBOR.CBORBuffer;
    using CBORDecoder for bytes;
    using BigIntCBOR for *;
    using FilecoinCBOR for *;

    /// @notice serialize WithdrawBalanceParams struct to cbor in order to pass as arguments to the market actor
    /// @param params WithdrawBalanceParams to serialize as cbor
    /// @return response cbor serialized data as bytes
    function serializeWithdrawBalanceParams(MarketTypes.WithdrawBalanceParams memory params) internal pure returns (bytes memory) {
        uint256 capacity = 0;
        bytes memory tokenAmount = params.tokenAmount.serializeBigInt();

        capacity += Misc.getPrefixSize(2);
        capacity += Misc.getBytesSize(params.provider_or_client.data);
        capacity += Misc.getBytesSize(tokenAmount);
        CBOR.CBORBuffer memory buf = CBOR.create(capacity);

        buf.startFixedArray(2);
        buf.writeBytes(params.provider_or_client.data);
        buf.writeBytes(tokenAmount);

        return buf.data();
    }

    /// @notice deserialize GetBalanceReturn struct from cbor encoded bytes coming from a market actor call
    /// @param rawResp cbor encoded response
    /// @return ret new instance of GetBalanceReturn created based on parsed data
    function deserializeGetBalanceReturn(bytes memory rawResp) internal pure returns (MarketTypes.GetBalanceReturn memory ret) {
        uint byteIdx = 0;
        uint len;
        bytes memory tmp;

        (len, byteIdx) = rawResp.readFixedArray(byteIdx);
        assert(len == 2);

        (tmp, byteIdx) = rawResp.readBytes(byteIdx);
        ret.balance = tmp.deserializeBigInt();

        (tmp, byteIdx) = rawResp.readBytes(byteIdx);
        ret.locked = tmp.deserializeBigInt();

        return ret;
    }

    /// @notice deserialize GetDealDataCommitmentReturn struct from cbor encoded bytes coming from a market actor call
    /// @param rawResp cbor encoded response
    /// @return ret new instance of GetDealDataCommitmentReturn created based on parsed data
    function deserializeGetDealDataCommitmentReturn(bytes memory rawResp) internal pure returns (MarketTypes.GetDealDataCommitmentReturn memory ret) {
        uint byteIdx = 0;
        uint len;

        (len, byteIdx) = rawResp.readFixedArray(byteIdx);

        if (len > 0) {
            (ret.data, byteIdx) = rawResp.readBytes(byteIdx);
            (ret.size, byteIdx) = rawResp.readUInt64(byteIdx);
        } else {
            ret.data = new bytes(0);
            ret.size = 0;
        }

        return ret;
    }

    /// @notice deserialize GetDealTermReturn struct from cbor encoded bytes coming from a market actor call
    /// @param rawResp cbor encoded response
    /// @return ret new instance of GetDealTermReturn created based on parsed data
    function deserializeGetDealTermReturn(bytes memory rawResp) internal pure returns (MarketTypes.GetDealTermReturn memory ret) {
        uint byteIdx = 0;
        uint len;

        (len, byteIdx) = rawResp.readFixedArray(byteIdx);
        assert(len == 2);

        (ret.start, byteIdx) = rawResp.readChainEpoch(byteIdx);
        (ret.end, byteIdx) = rawResp.readChainEpoch(byteIdx);

        return ret;
    }

    /// @notice deserialize GetDealActivationReturn struct from cbor encoded bytes coming from a market actor call
    /// @param rawResp cbor encoded response
    /// @return ret new instance of GetDealActivationReturn created based on parsed data
    function deserializeGetDealActivationReturn(bytes memory rawResp) internal pure returns (MarketTypes.GetDealActivationReturn memory ret) {
        uint byteIdx = 0;
        uint len;

        (len, byteIdx) = rawResp.readFixedArray(byteIdx);
        assert(len == 2);

        (ret.activated, byteIdx) = rawResp.readChainEpoch(byteIdx);
        (ret.terminated, byteIdx) = rawResp.readChainEpoch(byteIdx);

        return ret;
    }

    /// @notice serialize PublishStorageDealsParams struct to cbor in order to pass as arguments to the market actor
    /// @param params PublishStorageDealsParams to serialize as cbor
    /// @return cbor serialized data as bytes
    function serializePublishStorageDealsParams(MarketTypes.PublishStorageDealsParams memory params) internal pure returns (bytes memory) {
        uint256 capacity = 0;

        capacity += Misc.getPrefixSize(1);
        capacity += Misc.getPrefixSize(params.deals.length);

        for (uint64 i = 0; i < params.deals.length; i++) {
            capacity += Misc.getPrefixSize(2);
            capacity += Misc.getPrefixSize(11);

            capacity += Misc.getCidSize(params.deals[i].proposal.piece_cid.data);
            capacity += Misc.getPrefixSize(params.deals[i].proposal.piece_size);
            capacity += Misc.getBoolSize();
            capacity += Misc.getBytesSize(params.deals[i].proposal.client.data);
            capacity += Misc.getBytesSize(params.deals[i].proposal.provider.data);
            capacity += Misc.getBytesSize(params.deals[i].proposal.label.data);
            capacity += Misc.getChainEpochSize(params.deals[i].proposal.start_epoch);
            capacity += Misc.getChainEpochSize(params.deals[i].proposal.end_epoch);
            capacity += Misc.getBytesSize(params.deals[i].proposal.storage_price_per_epoch.serializeBigInt());
            capacity += Misc.getBytesSize(params.deals[i].proposal.provider_collateral.serializeBigInt());
            capacity += Misc.getBytesSize(params.deals[i].proposal.client_collateral.serializeBigInt());

            capacity += Misc.getBytesSize(params.deals[i].client_signature);
        }

        CBOR.CBORBuffer memory buf = CBOR.create(capacity);

        buf.startFixedArray(1);
        buf.startFixedArray(uint64(params.deals.length));

        for (uint64 i = 0; i < params.deals.length; i++) {
            buf.startFixedArray(2);

            buf.startFixedArray(11);

            buf.writeCid(params.deals[i].proposal.piece_cid.data);
            buf.writeUInt64(params.deals[i].proposal.piece_size);
            buf.writeBool(params.deals[i].proposal.verified_deal);
            buf.writeBytes(params.deals[i].proposal.client.data);
            buf.writeBytes(params.deals[i].proposal.provider.data);
            buf.writeDealLabel(params.deals[i].proposal.label);
            buf.writeChainEpoch(params.deals[i].proposal.start_epoch);
            buf.writeChainEpoch(params.deals[i].proposal.end_epoch);
            buf.writeBytes(params.deals[i].proposal.storage_price_per_epoch.serializeBigInt());
            buf.writeBytes(params.deals[i].proposal.provider_collateral.serializeBigInt());
            buf.writeBytes(params.deals[i].proposal.client_collateral.serializeBigInt());

            buf.writeBytes(params.deals[i].client_signature);
        }

        return buf.data();
    }

    /// @notice deserialize PublishStorageDealsReturn struct from cbor encoded bytes coming from a market actor call
    /// @param rawResp cbor encoded response
    /// @return ret new instance of PublishStorageDealsReturn created based on parsed data
    function deserializePublishStorageDealsReturn(bytes memory rawResp) internal pure returns (MarketTypes.PublishStorageDealsReturn memory ret) {
        uint byteIdx = 0;
        uint len;

        (len, byteIdx) = rawResp.readFixedArray(byteIdx);
        assert(len == 2);

        (len, byteIdx) = rawResp.readFixedArray(byteIdx);
        ret.ids = new uint64[](len);

        for (uint i = 0; i < len; i++) {
            (ret.ids[i], byteIdx) = rawResp.readUInt64(byteIdx);
        }

        (ret.valid_deals, byteIdx) = rawResp.readBytes(byteIdx);

        return ret;
    }

    /// @notice serialize deal id (uint64) to cbor in order to pass as arguments to the market actor
    /// @param id deal id to serialize as cbor
    /// @return cbor serialized data as bytes
    function serializeDealID(uint64 id) internal pure returns (bytes memory) {
        uint256 capacity = Misc.getPrefixSize(uint256(id));
        CBOR.CBORBuffer memory buf = CBOR.create(capacity);

        buf.writeUInt64(id);

        return buf.data();
    }

    function deserializeMarketDealNotifyParams(bytes memory rawResp) internal pure returns (MarketTypes.MarketDealNotifyParams memory ret) {
        uint byteIdx = 0;
        uint len;

        (len, byteIdx) = rawResp.readFixedArray(byteIdx);
        assert(len == 2);

        (ret.dealProposal, byteIdx) = rawResp.readBytes(byteIdx);
        (ret.dealId, byteIdx) = rawResp.readUInt64(byteIdx);
    }

    function serializeDealProposal(MarketTypes.DealProposal memory dealProposal) internal pure returns (bytes memory) {
        uint256 capacity = 0;
        bytes memory storage_price_per_epoch = dealProposal.storage_price_per_epoch.serializeBigInt();
        bytes memory provider_collateral = dealProposal.provider_collateral.serializeBigInt();
        bytes memory client_collateral = dealProposal.client_collateral.serializeBigInt();

        capacity += Misc.getPrefixSize(11);
        capacity += Misc.getCidSize(dealProposal.piece_cid.data);
        capacity += Misc.getPrefixSize(dealProposal.piece_size);
        capacity += Misc.getBoolSize();
        capacity += Misc.getBytesSize(dealProposal.client.data);
        capacity += Misc.getBytesSize(dealProposal.provider.data);
        capacity += Misc.getBytesSize(dealProposal.label.data);
        capacity += Misc.getChainEpochSize(dealProposal.start_epoch);
        capacity += Misc.getChainEpochSize(dealProposal.end_epoch);
        capacity += Misc.getBytesSize(storage_price_per_epoch);
        capacity += Misc.getBytesSize(provider_collateral);
        capacity += Misc.getBytesSize(client_collateral);
        CBOR.CBORBuffer memory buf = CBOR.create(capacity);

        buf.startFixedArray(11);

        buf.writeCid(dealProposal.piece_cid.data);
        buf.writeUInt64(dealProposal.piece_size);
        buf.writeBool(dealProposal.verified_deal);
        buf.writeBytes(dealProposal.client.data);
        buf.writeBytes(dealProposal.provider.data);
        buf.writeDealLabel(dealProposal.label);
        buf.writeChainEpoch(dealProposal.start_epoch);
        buf.writeChainEpoch(dealProposal.end_epoch);
        buf.writeBytes(storage_price_per_epoch);
        buf.writeBytes(provider_collateral);
        buf.writeBytes(client_collateral);

        return buf.data();
    }

    function deserializeDealProposal(bytes memory rawResp) internal pure returns (MarketTypes.DealProposal memory ret) {
        uint byteIdx = 0;
        uint len;
        bytes memory tmp;

        (len, byteIdx) = rawResp.readFixedArray(byteIdx);
        assert(len == 11);

        (ret.piece_cid, byteIdx) = rawResp.readCid(byteIdx);
        (ret.piece_size, byteIdx) = rawResp.readUInt64(byteIdx);
        (ret.verified_deal, byteIdx) = rawResp.readBool(byteIdx);
        (tmp, byteIdx) = rawResp.readBytes(byteIdx);
        ret.client = FilAddresses.fromBytes(tmp);

        (tmp, byteIdx) = rawResp.readBytes(byteIdx);
        ret.provider = FilAddresses.fromBytes(tmp);

        (ret.label, byteIdx) = rawResp.readDealLabel(byteIdx);

        (ret.start_epoch, byteIdx) = rawResp.readChainEpoch(byteIdx);
        (ret.end_epoch, byteIdx) = rawResp.readChainEpoch(byteIdx);

        bytes memory storage_price_per_epoch_bytes;
        (storage_price_per_epoch_bytes, byteIdx) = rawResp.readBytes(byteIdx);
        ret.storage_price_per_epoch = storage_price_per_epoch_bytes.deserializeBigInt();

        bytes memory provider_collateral_bytes;
        (provider_collateral_bytes, byteIdx) = rawResp.readBytes(byteIdx);
        ret.provider_collateral = provider_collateral_bytes.deserializeBigInt();

        bytes memory client_collateral_bytes;
        (client_collateral_bytes, byteIdx) = rawResp.readBytes(byteIdx);
        ret.client_collateral = client_collateral_bytes.deserializeBigInt();
    }
}


// File @zondax/filecoin-solidity/contracts/v0.8/utils/Actor.sol@v4.0.3

/*******************************************************************************
 *   (c) 2022 Zondax AG
 *
 *  Licensed under the Apache License, Version 2.0 (the "License");
 *  you may not use this file except in compliance with the License.
 *  You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 *  Unless required by applicable law or agreed to in writing, software
 *  distributed under the License is distributed on an "AS IS" BASIS,
 *  WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 *  See the License for the specific language governing permissions and
 *  limitations under the License.
 ********************************************************************************/
// THIS CODE WAS SECURITY REVIEWED BY KUDELSKI SECURITY, BUT NOT FORMALLY AUDITED

// Original license: SPDX_License_Identifier: Apache-2.0
pragma solidity ^0.8.17;


/// @title Call actors utilities library, meant to interact with Filecoin builtin actors
/// @author Zondax AG
library Actor {
    /// @notice precompile address for the call_actor precompile
    address constant CALL_ACTOR_ADDRESS = 0xfe00000000000000000000000000000000000003;

    /// @notice precompile address for the call_actor_id precompile
    address constant CALL_ACTOR_ID = 0xfe00000000000000000000000000000000000005;

    /// @notice flag used to indicate that the call_actor or call_actor_id should perform a static_call to the desired actor
    uint64 constant READ_ONLY_FLAG = 0x00000001;

    /// @notice flag used to indicate that the call_actor or call_actor_id should perform a call to the desired actor
    uint64 constant DEFAULT_FLAG = 0x00000000;

    /// @notice the provided address is not valid
    error InvalidAddress(bytes addr);

    /// @notice the smart contract has no enough balance to transfer
    error NotEnoughBalance(uint256 balance, uint256 value);

    /// @notice the provided actor id is not valid
    error InvalidActorID(CommonTypes.FilActorId actorId);

    /// @notice an error happened trying to call the actor
    error FailToCallActor();

    /// @notice the response received is not correct. In some case no response is expected and we received one, or a response was indeed expected and we received none.
    error InvalidResponseLength();

    /// @notice the codec received is not valid
    error InvalidCodec(uint64);

    /// @notice the called actor returned an error as part of its expected behaviour
    error ActorError(int256 errorCode);

    /// @notice the actor is not found
    error ActorNotFound();

    /// @notice allows to interact with an specific actor by its address (bytes format)
    /// @param actor_address actor address (bytes format) to interact with
    /// @param method_num id of the method from the actor to call
    /// @param codec how the request data passed as argument is encoded
    /// @param raw_request encoded arguments to be passed in the call
    /// @param value tokens to be transferred to the called actor
    /// @param static_call indicates if the call will be allowed to change the actor state or not (just read the state)
    /// @return payload (in bytes) with the actual response data (without codec or response code)
    function callByAddress(
        bytes memory actor_address,
        uint256 method_num,
        uint64 codec,
        bytes memory raw_request,
        uint256 value,
        bool static_call
    ) internal returns (bytes memory) {
        if (actor_address.length < 2) {
            revert InvalidAddress(actor_address);
        }

        validatePrecompileCall(CALL_ACTOR_ADDRESS, value);

        // We have to delegate-call the call-actor precompile because the call-actor precompile will
        // call the target actor on our behalf. This will _not_ delegate to the target `actor_address`.
        //
        // Specifically:
        //
        // - `static_call == false`: `CALLER (you) --(DELEGATECALL)-> CALL_ACTOR_PRECOMPILE --(CALL)-> actor_address
        // - `static_call == true`:  `CALLER (you) --(DELEGATECALL)-> CALL_ACTOR_PRECOMPILE --(STATICCALL)-> actor_address
        (bool success, bytes memory data) = address(CALL_ACTOR_ADDRESS).delegatecall(
            abi.encode(uint64(method_num), value, static_call ? READ_ONLY_FLAG : DEFAULT_FLAG, codec, raw_request, actor_address)
        );
        if (!success) {
            revert FailToCallActor();
        }

        return readRespData(data);
    }

    /// @notice allows to interact with an specific actor by its id (uint64)
    /// @param target actor id (uint64) to interact with
    /// @param method_num id of the method from the actor to call
    /// @param codec how the request data passed as argument is encoded
    /// @param raw_request encoded arguments to be passed in the call
    /// @param value tokens to be transferred to the called actor
    /// @param static_call indicates if the call will be allowed to change the actor state or not (just read the state)
    /// @return payload (in bytes) with the actual response data (without codec or response code)
    function callByID(
        CommonTypes.FilActorId target,
        uint256 method_num,
        uint64 codec,
        bytes memory raw_request,
        uint256 value,
        bool static_call
    ) internal returns (bytes memory) {
        validatePrecompileCall(CALL_ACTOR_ID, value);

        (bool success, bytes memory data) = address(CALL_ACTOR_ID).delegatecall(
            abi.encode(uint64(method_num), value, static_call ? READ_ONLY_FLAG : DEFAULT_FLAG, codec, raw_request, target)
        );
        if (!success) {
            revert FailToCallActor();
        }

        return readRespData(data);
    }

    /// @notice allows to run some generic validations before calling the precompile actor
    /// @param addr precompile actor address to run check to
    /// @param value tokens to be transferred to the called actor
    function validatePrecompileCall(address addr, uint256 value) internal view {
        uint balance = address(this).balance;
        if (balance < value) {
            revert NotEnoughBalance(balance, value);
        }

        bool actorExists = Misc.addressExists(addr);
        if (!actorExists) {
            revert ActorNotFound();
        }
    }

    /// @notice allows to interact with an non-singleton actors by its id (uint64)
    /// @param target actor id (uint64) to interact with
    /// @param method_num id of the method from the actor to call
    /// @param codec how the request data passed as argument is encoded
    /// @param raw_request encoded arguments to be passed in the call
    /// @param value tokens to be transfered to the called actor
    /// @param static_call indicates if the call will be allowed to change the actor state or not (just read the state)
    /// @dev it requires the id to be bigger than 99, as singleton actors are smaller than that
    function callNonSingletonByID(
        CommonTypes.FilActorId target,
        uint256 method_num,
        uint64 codec,
        bytes memory raw_request,
        uint256 value,
        bool static_call
    ) internal returns (bytes memory) {
        if (CommonTypes.FilActorId.unwrap(target) < 100) {
            revert InvalidActorID(target);
        }

        return callByID(target, method_num, codec, raw_request, value, static_call);
    }

    /// @notice parse the response an actor returned
    /// @notice it will validate the return code (success) and the codec (valid one)
    /// @param raw_response raw data (bytes) the actor returned
    /// @return the actual raw data (payload, in bytes) to be parsed according to the actor and method called
    function readRespData(bytes memory raw_response) internal pure returns (bytes memory) {
        (int256 exit, uint64 return_codec, bytes memory return_value) = abi.decode(raw_response, (int256, uint64, bytes));

        if (return_codec == Misc.NONE_CODEC) {
            if (return_value.length != 0) {
                revert InvalidResponseLength();
            }
        } else if (return_codec == Misc.CBOR_CODEC || return_codec == Misc.DAG_CBOR_CODEC) {
            if (return_value.length == 0) {
                revert InvalidResponseLength();
            }
        } else {
            revert InvalidCodec(return_codec);
        }

        if (exit != 0) {
            revert ActorError(exit);
        }

        return return_value;
    }
}


// File @zondax/filecoin-solidity/contracts/v0.8/MarketAPI.sol@v4.0.3

/*******************************************************************************
 *   (c) 2022 Zondax AG
 *
 *  Licensed under the Apache License, Version 2.0 (the "License");
 *  you may not use this file except in compliance with the License.
 *  You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 *  Unless required by applicable law or agreed to in writing, software
 *  distributed under the License is distributed on an "AS IS" BASIS,
 *  WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 *  See the License for the specific language governing permissions and
 *  limitations under the License.
 ********************************************************************************/
//
// THIS CODE WAS SECURITY REVIEWED BY KUDELSKI SECURITY, BUT NOT FORMALLY AUDITED

// Original license: SPDX_License_Identifier: Apache-2.0
pragma solidity ^0.8.17;






/// @title This library is a proxy to the singleton Storage Market actor (address: f05). Calling one of its methods will result in a cross-actor call being performed.
/// @author Zondax AG
library MarketAPI {
    using BytesCBOR for bytes;
    using MarketCBOR for *;
    using FilecoinCBOR for *;

    /// @notice Deposits the received value into the balance held in escrow.
    function addBalance(CommonTypes.FilAddress memory providerOrClient, uint256 value) internal {
        bytes memory raw_request = providerOrClient.serializeAddress();

        bytes memory data = Actor.callByID(MarketTypes.ActorID, MarketTypes.AddBalanceMethodNum, Misc.CBOR_CODEC, raw_request, value, false);
        if (data.length != 0) {
            revert Actor.InvalidResponseLength();
        }
    }

    /// @notice Attempt to withdraw the specified amount from the balance held in escrow.
    /// @notice If less than the specified amount is available, yields the entire available balance.
    function withdrawBalance(MarketTypes.WithdrawBalanceParams memory params) internal returns (CommonTypes.BigInt memory) {
        bytes memory raw_request = params.serializeWithdrawBalanceParams();

        bytes memory result = Actor.callByID(MarketTypes.ActorID, MarketTypes.WithdrawBalanceMethodNum, Misc.CBOR_CODEC, raw_request, 0, false);

        return result.deserializeBytesBigInt();
    }

    /// @notice Return the escrow balance and locked amount for an address.
    /// @return the escrow balance and locked amount for an address.
    function getBalance(CommonTypes.FilAddress memory addr) internal returns (MarketTypes.GetBalanceReturn memory) {
        bytes memory raw_request = addr.serializeAddress();

        bytes memory result = Actor.callByID(MarketTypes.ActorID, MarketTypes.GetBalanceMethodNum, Misc.CBOR_CODEC, raw_request, 0, true);

        return result.deserializeGetBalanceReturn();
    }

    /// @notice This will be available after the deal is published (whether or not is is activated) and up until some undefined period after it is terminated.
    /// @return the data commitment and size of a deal proposal.
    function getDealDataCommitment(uint64 dealID) internal returns (MarketTypes.GetDealDataCommitmentReturn memory) {
        bytes memory raw_request = dealID.serializeDealID();

        bytes memory result = Actor.callByID(MarketTypes.ActorID, MarketTypes.GetDealDataCommitmentMethodNum, Misc.CBOR_CODEC, raw_request, 0, true);

        return result.deserializeGetDealDataCommitmentReturn();
    }

    /// @notice get the client of the deal proposal.
    /// @return the client of a deal proposal.
    function getDealClient(uint64 dealID) internal returns (uint64) {
        bytes memory raw_request = dealID.serializeDealID();

        bytes memory result = Actor.callByID(MarketTypes.ActorID, MarketTypes.GetDealClientMethodNum, Misc.CBOR_CODEC, raw_request, 0, true);

        return result.deserializeUint64();
    }

    /// @notice get the provider of a deal proposal.
    /// @return the provider of a deal proposal.
    function getDealProvider(uint64 dealID) internal returns (uint64) {
        bytes memory raw_request = dealID.serializeDealID();

        bytes memory result = Actor.callByID(MarketTypes.ActorID, MarketTypes.GetDealProviderMethodNum, Misc.CBOR_CODEC, raw_request, 0, true);

        return result.deserializeUint64();
    }

    /// @notice Get the label of a deal proposal.
    /// @return the label of a deal proposal.
    function getDealLabel(uint64 dealID) internal returns (CommonTypes.DealLabel memory) {
        bytes memory raw_request = dealID.serializeDealID();

        bytes memory result = Actor.callByID(MarketTypes.ActorID, MarketTypes.GetDealLabelMethodNum, Misc.CBOR_CODEC, raw_request, 0, true);

        return result.deserializeDealLabel();
    }

    /// @notice Get the start epoch and duration(in epochs) of a deal proposal.
    /// @return the start epoch and duration (in epochs) of a deal proposal.
    function getDealTerm(uint64 dealID) internal returns (MarketTypes.GetDealTermReturn memory) {
        bytes memory raw_request = dealID.serializeDealID();

        bytes memory result = Actor.callByID(MarketTypes.ActorID, MarketTypes.GetDealTermMethodNum, Misc.CBOR_CODEC, raw_request, 0, true);

        return result.deserializeGetDealTermReturn();
    }

    /// @notice get the total price that will be paid from the client to the provider for this deal.
    /// @return the per-epoch price of a deal proposal.
    function getDealTotalPrice(uint64 dealID) internal returns (CommonTypes.BigInt memory) {
        bytes memory raw_request = dealID.serializeDealID();

        bytes memory result = Actor.callByID(MarketTypes.ActorID, MarketTypes.GetDealTotalPriceMethodNum, Misc.CBOR_CODEC, raw_request, 0, true);

        return result.deserializeBytesBigInt();
    }

    /// @notice get the client collateral requirement for a deal proposal.
    /// @return the client collateral requirement for a deal proposal.
    function getDealClientCollateral(uint64 dealID) internal returns (CommonTypes.BigInt memory) {
        bytes memory raw_request = dealID.serializeDealID();

        bytes memory result = Actor.callByID(MarketTypes.ActorID, MarketTypes.GetDealClientCollateralMethodNum, Misc.CBOR_CODEC, raw_request, 0, true);

        return result.deserializeBytesBigInt();
    }

    /// @notice get the provide collateral requirement for a deal proposal.
    /// @return the provider collateral requirement for a deal proposal.
    function getDealProviderCollateral(uint64 dealID) internal returns (CommonTypes.BigInt memory) {
        bytes memory raw_request = dealID.serializeDealID();

        bytes memory result = Actor.callByID(MarketTypes.ActorID, MarketTypes.GetDealProviderCollateralMethodNum, Misc.CBOR_CODEC, raw_request, 0, true);

        return result.deserializeBytesBigInt();
    }

    /// @notice get the verified flag for a deal proposal.
    /// @notice Note that the source of truth for verified allocations and claims is the verified registry actor.
    /// @return the verified flag for a deal proposal.
    function getDealVerified(uint64 dealID) internal returns (bool) {
        bytes memory raw_request = dealID.serializeDealID();

        bytes memory result = Actor.callByID(MarketTypes.ActorID, MarketTypes.GetDealVerifiedMethodNum, Misc.CBOR_CODEC, raw_request, 0, true);

        return result.deserializeBool();
    }

    /// @notice Fetches activation state for a deal.
    /// @notice This will be available from when the proposal is published until an undefined period after the deal finishes (either normally or by termination).
    /// @return USR_NOT_FOUND if the deal doesn't exist (yet), or EX_DEAL_EXPIRED if the deal has been removed from state.
    function getDealActivation(uint64 dealID) internal returns (MarketTypes.GetDealActivationReturn memory) {
        bytes memory raw_request = dealID.serializeDealID();

        bytes memory result = Actor.callByID(MarketTypes.ActorID, MarketTypes.GetDealActivationMethodNum, Misc.CBOR_CODEC, raw_request, 0, true);

        return result.deserializeGetDealActivationReturn();
    }

    /// @notice Publish a new set of storage deals (not yet included in a sector).
    function publishStorageDeals(MarketTypes.PublishStorageDealsParams memory params) internal returns (MarketTypes.PublishStorageDealsReturn memory) {
        bytes memory raw_request = params.serializePublishStorageDealsParams();

        bytes memory result = Actor.callByID(MarketTypes.ActorID, MarketTypes.PublishStorageDealsMethodNum, Misc.CBOR_CODEC, raw_request, 0, false);

        return result.deserializePublishStorageDealsReturn();
    }
}


// File contracts/Aggregator.sol

// Aggregator.sol
// Original license: SPDX_License_Identifier: MIT
pragma solidity ^0.8.19;

// --- Import Zondax FEVM Library Components ---
/**
 * @title Aggregator Contract
 * @notice Aggregates verification results from multiple agents, verifies associated evidence stored on Filecoin, and distributes rewards.
 * @dev Uses the Zondax Filecoin Solidity library to interact with the Market actor.
 * IMPORTANT: Ensure sufficient gas limits when calling aggregateResults, especially with many submissions or CIDs.
 * WARNING: The aggregateResults function WILL REVERT if ANY deal check via MarketAPI.getDealActivation fails (e.g., invalid deal ID).
 */
contract Aggregator {
    // --- State Variables ---

    address public owner;

    // Mapping: requestContext -> list of submissions for that context
    mapping(string => VerifierSubmission[]) public submissions;
    // Mapping: requestContext -> aggregated final verdict
    mapping(string => AggregatedVerdict) public verdicts;
    // Mapping: evidence CID -> information about the evidence
    mapping(string => EvidenceInfo) public evidenceRegistry;
    // Mapping: agentId (string) -> agent's payout address
    mapping(string => address) public agentRegistry;

    // --- Structs ---

    struct VerifierSubmission {
        string agentId;
        string verdict; // "Supported", "Contradicted", "Neutral"
        uint8 confidence; // 0-100
        string evidenceCid; // CID of supporting evidence, can be empty
    }

    struct AggregatedVerdict {
        string finalVerdict; // e.g., "Verified", "Flagged: Contradictory", "Uncertain"
        uint8 finalConfidence;
        string[] evidenceCids; // CIDs that were *active* and supported the consensus
        address aggregator; // Address that triggered the aggregation
        uint timestamp; // Block timestamp of aggregation
        uint submissionCount; // Number of submissions considered
        bool exists; // Flag to check if a verdict has been aggregated
    }

    struct EvidenceInfo {
        address submitter; // Address that registered the evidence
        uint64 dealId; // Filecoin Deal ID associated with the CID storage
        uint256 usageScore; // Tracks how often this evidence was used in a consensus
        bool exists; // Flag to check if evidence is registered
    }

    // --- Events ---

    event EvidenceRegistered(string indexed cid, address indexed submitter, uint64 indexed dealId);
    event AgentRegistered(string indexed agentId, address indexed payoutAddress);
    event VerdictSubmitted(string indexed requestContext, string agentId, string verdict, uint8 confidence, string evidenceCid);
    event VerdictAggregated(string indexed requestContext, string finalVerdict, uint8 finalConfidence, string[] evidenceCids, uint submissionCount);
    event RewardPaid(string indexed requestContext, address indexed recipient, string reason, string evidenceCid, uint256 amount);
    event RewardTransferFailed(address indexed recipient, string reason, uint256 amount);
    event AggregationError(string indexed requestContext, string reason);
    event DealCheckResult(string indexed requestContext, string indexed cid, uint64 dealId, bool isActive, int64 activatedEpoch, int64 terminatedEpoch);

    // --- Modifiers ---

    modifier onlyOwner() {
        require(msg.sender == owner, "Aggregator: Caller is not the owner");
        _;
    }

    // --- Contract Lifecycle ---

    receive() external payable {}

    constructor() {
        owner = msg.sender;
    }

    // --- Fund Management ---

    function depositFunds() external payable onlyOwner {}

    function withdrawFunds(uint256 amount) external onlyOwner {
        require(amount <= address(this).balance, "Aggregator: Insufficient contract balance");
        (bool success, ) = owner.call{value: amount}("");
        require(success, "Aggregator: Withdrawal failed");
    }

    // --- Registration Functions ---

    function registerEvidence(string calldata cid, address submitter, uint64 dealId) external onlyOwner {
        require(bytes(cid).length > 0, "Aggregator: CID cannot be empty");
        require(submitter != address(0), "Aggregator: Submitter address cannot be zero");
        require(dealId != 0, "Aggregator: Deal ID cannot be zero");
        require(!evidenceRegistry[cid].exists, "Aggregator: Evidence CID already registered");

        evidenceRegistry[cid] = EvidenceInfo({
            submitter: submitter,
            dealId: dealId,
            usageScore: 0,
            exists: true
        });
        emit EvidenceRegistered(cid, submitter, dealId);
    }

    function registerAgent(string calldata agentId, address payoutAddress) external {
        require(bytes(agentId).length > 0, "Aggregator: Agent ID cannot be empty");
        require(payoutAddress != address(0), "Aggregator: Payout address cannot be zero");
        agentRegistry[agentId] = payoutAddress;
        emit AgentRegistered(agentId, payoutAddress);
    }

    // --- Core Logic ---

    function submitVerificationResult(
        string calldata requestContext,
        string calldata agentId,
        string calldata verdict,
        uint8 confidence,
        string calldata evidenceCid
    ) external {
        require(bytes(requestContext).length > 0, "Aggregator: Request context required");
        require(confidence <= 100, "Aggregator: Confidence must be between 0 and 100");
        require(
            keccak256(bytes(verdict)) == keccak256(bytes("Supported")) ||
            keccak256(bytes(verdict)) == keccak256(bytes("Contradicted")) ||
            keccak256(bytes(verdict)) == keccak256(bytes("Neutral")),
            "Aggregator: Invalid verdict string"
        );

        submissions[requestContext].push(VerifierSubmission({
            agentId: agentId,
            verdict: verdict,
            confidence: confidence,
            evidenceCid: evidenceCid
        }));
        emit VerdictSubmitted(requestContext, agentId, verdict, confidence, evidenceCid);
    }

    /**
     * @notice Aggregates submitted results for a given context, determines consensus, verifies evidence deals, and distributes rewards.
     * @param requestContext The identifier for the verification task to aggregate.
     * @dev Follows Checks-Effects-Interactions pattern to mitigate reentrancy.
     * @dev Gas cost can be significant depending on the number of submissions and CIDs. Consider limits or alternative patterns for large scale.
     * WARNING: This function WILL REVERT if ANY deal check via MarketAPI.getDealActivation fails (e.g., invalid deal ID).
     */
    function aggregateResults(string calldata requestContext) external {
        // --- Checks ---
        require(!verdicts[requestContext].exists, "Aggregator: Verdict already aggregated for this context");
        VerifierSubmission[] storage agentSubmissions = submissions[requestContext];
        uint numSubmissions = agentSubmissions.length;
        require(numSubmissions > 0, "Aggregator: No submissions found for this context");

        // --- Calculate Consensus ---
        (
            string memory consensusVerdictStr,
            uint8 consensusConfidence,
            bool requiresEvidenceCheck
        ) = _calculateConsensus(agentSubmissions, numSubmissions);

        // --- Collect Winners ---
        (
            string[] memory finalWinningAgentIds,
            string[] memory finalPotentialWinningCids
        ) = _collectPotentialWinners(agentSubmissions, numSubmissions, consensusVerdictStr, requiresEvidenceCheck);


        // --- Verify Deals & Filter CIDs ---
         string[] memory finalActiveEvidenceCids = _verifyDealsAndGetActiveCIDs(
             requestContext,
             finalPotentialWinningCids,
             requiresEvidenceCheck
         );

        // --- Distribute Rewards ---
        uint256 totalRewardPool = address(this).balance / 2; // Example: Use 50% of balance
        uint256 submitterRewardPool = totalRewardPool / 2; // Example: 25% for submitters
        uint256 agentRewardPool = totalRewardPool - submitterRewardPool; // Example: 25% for agents

        _distributeRewards(
            requestContext,
            finalActiveEvidenceCids,
            finalWinningAgentIds,
            submitterRewardPool,
            agentRewardPool
        );

        // --- Final State Update (Effect part 3) ---
        verdicts[requestContext] = AggregatedVerdict({
            finalVerdict: consensusVerdictStr,
            finalConfidence: consensusConfidence,
            evidenceCids: finalActiveEvidenceCids,
            aggregator: msg.sender,
            timestamp: block.timestamp,
            submissionCount: numSubmissions,
            exists: true
        });

        emit VerdictAggregated(requestContext, consensusVerdictStr, consensusConfidence, finalActiveEvidenceCids, numSubmissions);
    }


    // --- Internal Helper Functions for Refactoring ---

    /**
     * @dev Calculates the consensus verdict, confidence, and if evidence check is needed.
     */
    function _calculateConsensus(
        VerifierSubmission[] storage agentSubmissions,
        uint numSubmissions
    ) internal view returns (string memory consensusVerdictStr, uint8 consensusConfidence, bool requiresEvidenceCheck)
    {
        uint supportVotes = 0;
        uint contradictVotes = 0;
        uint supportConfidenceSum = 0;
        uint contradictConfidenceSum = 0;

        for (uint i = 0; i < numSubmissions; i++) {
            VerifierSubmission storage sub = agentSubmissions[i];
            if (keccak256(bytes(sub.verdict)) == keccak256(bytes("Supported"))) {
                supportVotes++;
                supportConfidenceSum += sub.confidence;
            } else if (keccak256(bytes(sub.verdict)) == keccak256(bytes("Contradicted"))) {
                contradictVotes++;
                contradictConfidenceSum += sub.confidence;
            }
        }

        uint requiredVotes = (numSubmissions / 2) + 1;

        if (supportVotes >= requiredVotes) {
            consensusVerdictStr = "Verified";
            if (supportVotes > 0) { consensusConfidence = uint8(supportConfidenceSum / supportVotes); }
            requiresEvidenceCheck = true;
        } else if (contradictVotes >= requiredVotes) {
            consensusVerdictStr = "Flagged: Contradictory";
            if (contradictVotes > 0) { consensusConfidence = uint8(contradictConfidenceSum / contradictVotes); }
             requiresEvidenceCheck = true;
        } else {
            consensusVerdictStr = "Uncertain";
            consensusConfidence = 0;
            requiresEvidenceCheck = false; // No evidence check needed if uncertain
        }

        return (consensusVerdictStr, consensusConfidence, requiresEvidenceCheck);
    }

    /**
     * @dev Collects winning agent IDs and potential winning CIDs based on the consensus.
     */
    function _collectPotentialWinners(
         VerifierSubmission[] storage agentSubmissions,
         uint numSubmissions,
         string memory consensusVerdictStr,
         bool requiresEvidenceCheck
     ) internal view returns (string[] memory finalWinningAgentIds, string[] memory finalPotentialWinningCids)
     {
        if (!requiresEvidenceCheck) {
            return (new string[](0), new string[](0));
        }

        string[] memory winningAgentIds = new string[](numSubmissions);
        uint winningAgentCount = 0;
        string[] memory potentialWinningCidsArray = new string[](numSubmissions);
        uint potentialWinningCidCount = 0;

        string memory requiredVerdict = "";
        if (keccak256(bytes(consensusVerdictStr)) == keccak256(bytes("Verified"))) {
            requiredVerdict = "Supported";
        } else if (keccak256(bytes(consensusVerdictStr)) == keccak256(bytes("Flagged: Contradictory"))) {
            requiredVerdict = "Contradicted";
        }

        if(bytes(requiredVerdict).length > 0) {
            bytes32 requiredVerdictHash = keccak256(bytes(requiredVerdict));
            for (uint i = 0; i < numSubmissions; i++) {
                if (keccak256(bytes(agentSubmissions[i].verdict)) == requiredVerdictHash) {
                    winningAgentIds[winningAgentCount++] = agentSubmissions[i].agentId;
                    string memory cid = agentSubmissions[i].evidenceCid;
                    if (bytes(cid).length > 0 && evidenceRegistry[cid].exists) {
                       potentialWinningCidsArray[potentialWinningCidCount++] = cid;
                    }
                }
            }
        }

        finalWinningAgentIds = new string[](winningAgentCount);
        for(uint i = 0; i < winningAgentCount; i++){ finalWinningAgentIds[i] = winningAgentIds[i]; }
        finalPotentialWinningCids = new string[](potentialWinningCidCount);
        for(uint i = 0; i < potentialWinningCidCount; i++){ finalPotentialWinningCids[i] = potentialWinningCidsArray[i]; }

        return (finalWinningAgentIds, finalPotentialWinningCids);
    }

     /**
      * @dev Verifies deals for potential CIDs and returns an array of unique, active CIDs.
      * WARNING: This internal function WILL REVERT if ANY MarketAPI call fails.
      */
    function _verifyDealsAndGetActiveCIDs(
        string memory requestContext,
        string[] memory potentialWinningCids,
        bool requiresEvidenceCheck
    ) internal returns (string[] memory finalActiveEvidenceCids)
    {
        uint potentialWinningCidCount = potentialWinningCids.length;
        if (!requiresEvidenceCheck || potentialWinningCidCount == 0) {
            return new string[](0);
        }

        string[] memory activeEvidenceCids = new string[](potentialWinningCidCount);
        uint activeEvidenceCount = 0;

        for (uint i = 0; i < potentialWinningCidCount; i++) {
            string memory cid = potentialWinningCids[i];
            EvidenceInfo storage evInfo = evidenceRegistry[cid]; // Assumed to exist

            if (evInfo.dealId > 0) {
                // --- Direct call - NO try/catch ---
                // WARNING: Reverts on failure
                MarketTypes.GetDealActivationReturn memory activationInfo = MarketAPI.getDealActivation(evInfo.dealId);
                int64 activatedEpoch = CommonTypes.ChainEpoch.unwrap(activationInfo.activated);
                int64 terminatedEpoch = CommonTypes.ChainEpoch.unwrap(activationInfo.terminated);
                bool dealActive = activatedEpoch > -1 && terminatedEpoch == -1;

                emit DealCheckResult(requestContext, cid, evInfo.dealId, dealActive, activatedEpoch, terminatedEpoch);
                // --- End MarketAPI call ---

                if (dealActive) {
                    bool alreadyAdded = false;
                    for (uint j = 0; j < activeEvidenceCount; j++) {
                        if (keccak256(bytes(activeEvidenceCids[j])) == keccak256(bytes(cid))) {
                            alreadyAdded = true;
                            break;
                        }
                    }
                    if (!alreadyAdded) {
                        activeEvidenceCids[activeEvidenceCount++] = cid;
                        evidenceRegistry[cid].usageScore++; // Increment usage score
                    }
                }
            }
        }

        finalActiveEvidenceCids = new string[](activeEvidenceCount);
        for(uint i = 0; i < activeEvidenceCount; i++){ finalActiveEvidenceCids[i] = activeEvidenceCids[i]; }

        return finalActiveEvidenceCids;
    }

    /**
     * @dev Distributes rewards to submitters and winning agents.
     */
    function _distributeRewards(
        string memory requestContext,
        string[] memory finalActiveEvidenceCids,
        string[] memory finalWinningAgentIds,
        uint256 submitterRewardPool,
        uint256 agentRewardPool
    ) internal {
        uint activeEvidenceCount = finalActiveEvidenceCids.length;
        uint winningAgentCount = finalWinningAgentIds.length;

        // Pay Submitters
        if (activeEvidenceCount > 0 && submitterRewardPool > 0) {
            uint256 submitterReward = submitterRewardPool / activeEvidenceCount;
            if (submitterReward > 0) {
                for (uint i = 0; i < activeEvidenceCount; i++) {
                    string memory cid = finalActiveEvidenceCids[i];
                    if (evidenceRegistry[cid].exists) {
                        address submitter = evidenceRegistry[cid].submitter;
                        if (submitter != address(0)) {
                            (bool sent, ) = payable(submitter).call{value: submitterReward}("");
                            if (sent) {
                                emit RewardPaid(requestContext, submitter, "Evidence Reward", cid, submitterReward);
                            } else {
                                emit RewardTransferFailed(submitter, "Evidence Reward", submitterReward);
                            }
                        } else {
                             emit AggregationError(requestContext, string.concat("Invalid submitter address for CID: ", cid));
                        }
                    }
                }
            }
        }

         // Pay Winning Agents
        if (winningAgentCount > 0 && agentRewardPool > 0) {
             uint256 agentReward = agentRewardPool / winningAgentCount;
             if (agentReward > 0) {
                 for (uint i = 0; i < winningAgentCount; i++) {
                     string memory agentId = finalWinningAgentIds[i];
                     address agentAddr = agentRegistry[agentId];
                     if (agentAddr != address(0)) {
                         (bool sent, ) = payable(agentAddr).call{value: agentReward}("");
                         if (sent) {
                              emit RewardPaid(requestContext, agentAddr, "Verifier Reward", "", agentReward);
                         } else {
                              emit RewardTransferFailed(agentAddr, "Verifier Reward", agentReward);
                         }
                     } else {
                         emit AggregationError(requestContext, string.concat("Agent not found or invalid address: ", agentId));
                     }
                 }
             }
        }
    }

    /**
     * @notice Helper function to convert uint to string (needed for error messages).
     */
    function uint2str(uint _i) internal pure returns (string memory _uintAsString) {
        if (_i == 0) {
            return "0";
        }
        uint j = _i;
        uint len;
        while (j != 0) {
            len++;
            j /= 10;
        }
        bytes memory bstr = new bytes(len);
        uint k = len;
        while (_i != 0) {
            k = k-1;
            uint8 temp = (48 + uint8(_i - _i / 10 * 10));
            bytes1 b1 = bytes1(temp);
            bstr[k] = b1;
            _i /= 10;
        }
        return string(bstr);
    }

    // --- View Functions ---

    function getAggregatedVerdict(string calldata requestContext) external view returns (AggregatedVerdict memory) {
        require(verdicts[requestContext].exists, "Aggregator: Verdict not yet aggregated for this context");
        return verdicts[requestContext];
    }

    function getSubmissions(string calldata requestContext) external view returns (VerifierSubmission[] memory) {
        return submissions[requestContext];
    }

    function getEvidenceInfo(string calldata cid) external view returns (EvidenceInfo memory) {
        return evidenceRegistry[cid];
    }

    function getAgentAddress(string calldata agentId) external view returns (address) {
        return agentRegistry[agentId];
    }
}
