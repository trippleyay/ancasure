// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title MevTestToken — plain vanilla ERC-20 for controlled Sepolia sandwich demo.
/// Fixed supply minted to the deployer. No fees, no hooks, no owner logic —
/// behaves identically to the standard tokens the Uniswap V2 router expects.
contract MevTestToken {
    string public constant name = "MEV Test";
    string public constant symbol = "MEVTEST";
    uint8 public constant decimals = 18;

    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    constructor(uint256 _mintAmount) {
        totalSupply = _mintAmount;
        balanceOf[msg.sender] = _mintAmount;
        emit Transfer(address(0), msg.sender, _mintAmount);
    }

    function transfer(address _to, uint256 _value) external returns (bool) {
        _transfer(msg.sender, _to, _value);
        return true;
    }

    function approve(address _spender, uint256 _value) external returns (bool) {
        allowance[msg.sender][_spender] = _value;
        emit Approval(msg.sender, _spender, _value);
        return true;
    }

    function transferFrom(address _from, address _to, uint256 _value) external returns (bool) {
        uint256 allowed = allowance[_from][msg.sender];
        require(allowed >= _value, "ERC20: insufficient allowance");
        if (allowed != type(uint256).max) {
            allowance[_from][msg.sender] = allowed - _value;
        }
        _transfer(_from, _to, _value);
        return true;
    }

    function _transfer(address _from, address _to, uint256 _value) internal {
        require(balanceOf[_from] >= _value, "ERC20: insufficient balance");
        require(_to != address(0), "ERC20: zero address");
        balanceOf[_from] -= _value;
        unchecked {
            balanceOf[_to] += _value;
        }
        emit Transfer(_from, _to, _value);
    }
}
