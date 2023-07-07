const { MerkleTree } = require('merkletreejs');
const keccak256 = require('keccak256');
const { generateSalt } = require('./helpers/utils');

const {
    shouldBehaveLikeMerkleDropFor4WalletsWithBalances1234,
} = require('./behaviors/MerkleDrop.behavior');

const {
    shouldBehaveLikeCumulativeMerkleDropFor4WalletsWithBalances1234,
} = require('./behaviors/CumulativeMerkleDrop.behavior');

const TokenMock = artifacts.require('TokenMock');
const CumulativeMerkleDrop128 = artifacts.require('CumulativeMerkleDrop128');

function keccak128 (input) {
    return keccak256(input).slice(0, 16);
}

async function makeDrop (token, drop, wallets, amounts, deposit) {
    const salts = wallets.map(_ => generateSalt());
    const elements = wallets.map((w, i) => salts[i] + w.substr(2) + BigInt(amounts[i]).toString(16).padStart(64, '0'));
    const hashedElements = elements.map(keccak128).map(x => MerkleTree.bufferToHex(x));
    const tree = new MerkleTree(elements, keccak128, { hashLeaves: true, sort: true });
    const root = tree.getHexRoot();
    const leaves = tree.getHexLeaves();
    const proofs = leaves
        .map(tree.getHexProof, tree)
        .map(proof => '0x' + proof.map(p => p.substr(2)).join(''));

    await drop.setMerkleRoot(root);
    await token.mint(drop.address, deposit);

    return { hashedElements, leaves, root, proofs, salts };
}

contract('CumulativeMerkleDrop128', async function ([_, w1, w2, w3, w4]) {
    const wallets = [w1, w2, w3, w4];

    function findSortedIndex (self, i) {
        return self.leaves.indexOf(self.hashedElements[i]);
    }

    beforeEach(async function () {
        this.token = await TokenMock.new('1INCH Token', '1INCH');
        this.drop = await CumulativeMerkleDrop128.new(this.token.address);
        await Promise.all(wallets.map(w => this.token.mint(w, 1)));
    });

    it('Benchmark 30000 wallets (merkle tree height 15)', async function () {
        const accounts = Array(30000).fill().map((_, i) => '0x' + (BigInt(w1) + BigInt(i)).toString(16));
        const amounts = Array(30000).fill().map((_, i) => i + 1);
        const { hashedElements, leaves, root, proofs, salts } = await makeDrop(this.token, this.drop, accounts, amounts, 1000000);
        this.hashedElements = hashedElements;
        this.leaves = leaves;
        this.root = root;
        this.proofs = proofs;

        if (this.drop.contract.methods.verify) {
            await this.drop.contract.methods.verify(this.proofs[findSortedIndex(this, 0)], this.root, this.leaves[findSortedIndex(this, 0)]).send({ from: _ });
            expect(await this.drop.verify(this.proofs[findSortedIndex(this, 0)], this.root, this.leaves[findSortedIndex(this, 0)])).to.be.true;
        }
        // await this.drop.contract.methods.verifyAsm(this.proofs[findSortedIndex(this, 0)], this.root, this.leaves[findSortedIndex(this, 0)]).send({ from: _ });
        // expect(await this.drop.verifyAsm(this.proofs[findSortedIndex(this, 0)], this.root, this.leaves[findSortedIndex(this, 0)])).to.be.true;
        await this.drop.claim(salts[0], accounts[0], 1, this.root, this.proofs[findSortedIndex(this, 0)]);
    });

    describe('Single drop for 4 wallets: [1, 2, 3, 4]', async function () {
        beforeEach(async function () {
            const { hashedElements, leaves, root, proofs, salts } = await makeDrop(this.token, this.drop, [w1, w2, w3, w4], [1, 2, 3, 4], 10);
            this.hashedElements = hashedElements;
            this.leaves = leaves;
            this.root = root;
            this.proofs = proofs;
            this.salts = salts;
        });

        shouldBehaveLikeMerkleDropFor4WalletsWithBalances1234('CMD', [w1, w2, w3, w4], findSortedIndex, true);
    });

    describe('Double drop for 4 wallets: [1, 2, 3, 4] + [2, 3, 4, 5] = [3, 5, 7, 9]', async function () {
        async function makeFirstDrop (self) {
            const { hashedElements, leaves, root, proofs, salts } = await makeDrop(self.token, self.drop, [w1, w2, w3, w4], [1, 2, 3, 4], 1 + 2 + 3 + 4);
            self.hashedElements = hashedElements;
            self.leaves = leaves;
            self.root = root;
            self.proofs = proofs;
            self.salts = salts;
        }

        async function makeSecondDrop (self) {
            const { hashedElements, leaves, root, proofs, salts } = await makeDrop(self.token, self.drop, [w1, w2, w3, w4], [3, 5, 7, 9], 2 + 3 + 4 + 5);
            self.hashedElements = hashedElements;
            self.leaves = leaves;
            self.root = root;
            self.proofs = proofs;
            self.salts = salts;
        }

        shouldBehaveLikeCumulativeMerkleDropFor4WalletsWithBalances1234('CMD', _, [w1, w2, w3, w4], findSortedIndex, makeFirstDrop, makeSecondDrop, true);
    });
});
