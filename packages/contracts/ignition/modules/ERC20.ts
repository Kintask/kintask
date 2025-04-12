import { buildModule } from "@nomicfoundation/ignition-core";

const EAS_ADDRESS = "0x..."; // <-- replace with already deployed EAS address
const SCHEMA_REGISTRY_ADDRESS = "0x..."; // <-- replace with already deployed SchemaRegistry address

export default buildModule("StringTokenMarketplace", (m) => {
  const erc20PaymentStatement = m.contract("ERC20PaymentStatement", [
    EAS_ADDRESS,
    SCHEMA_REGISTRY_ADDRESS,
  ]);

  const stringResultStatement = m.contract("StringResultStatement", [
    EAS_ADDRESS,
    SCHEMA_REGISTRY_ADDRESS,
  ]);

  return { erc20PaymentStatement, stringResultStatement };
});
