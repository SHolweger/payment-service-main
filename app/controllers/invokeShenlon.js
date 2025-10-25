const crypto = require("crypto");
const { Order } = require("../models");
const PRODUCTO_SERVICE= process.env.PRODUCTO_SERVICE
function rngFloat() {
  return crypto.randomInt(0, 1e9) / 1e9;
}

function computeProbFromAmount(amountGtq) {
  if (!Number.isFinite(amountGtq) || amountGtq <= 0) return 0;
  if (amountGtq >= 1000) return 0.7; // 70%
  if (amountGtq >= 800)  return 0.5; // 50%
  if (amountGtq >= 500)  return 0.3; // 30%
  return 0.1;                        // 10%
}

async function getLastOrderForUser(usuarioId) {
  return Order.findOne({
    where: { userId: usuarioId, status: "paid" },
    order: [["createdAt", "DESC"]],
  });
}

async function shouldInvokeShenron(usuarioId) {
  const order = await getLastOrderForUser(usuarioId);
  if (!order) {
    return { invoke: false, prob: 0, amountGtq: 0 };
  }

  const amountGtq = Number(order.amount_gtq || 0) / 100;
  const prob = computeProbFromAmount(amountGtq);
  const roll = rngFloat();
  const invoke = roll < prob;

  return { invoke, prob, amountGtq };
}

async function modifyInvocar(usuarioId) {
  if (!usuarioId) throw new Error("El usuarioId es obligatorio.");
    console.log(usuarioId);
  try {
    const { invoke, prob, amountGtq } = await shouldInvokeShenron(usuarioId);
    const response = await http.patch(
      `${PRODUCTO_SERVICE}/producto-service/invocar/${usuarioId}`,
      { invocar: invoke },  
      { headers }
    );

    console.log("[Invocar] Estado actualizado:", {
      usuarioId,
      invoke,
      prob,
      amountGtq,
      status: response.status,
    });

    return { invoke, prob, amountGtq };
  } catch (err) {
    throw new Error(
      "Error de servidor al momento de modificar una invocación",
      { cause: err }
    );
  }
}
module.exports = { modifyInvocar };