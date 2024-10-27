import { NextResponse } from "next/server";
import Stripe from "stripe";
import { sql } from "@vercel/postgres";
import { drizzle } from "drizzle-orm/vercel-postgres";
import { sql as dsql } from "drizzle-orm";

const stripe = new Stripe(process.env.STRIPE_SECRET);
const db = drizzle(sql);

export async function GET() {
  try {
    // Begin a transaction
    await db.transaction(async (trx) => {
      // Fetch all wallet rows with an amount greater than 10 and active status
      const walletRows = await trx.execute(
        dsql`SELECT email, amount FROM wallet WHERE amount > 10 AND status = 'active'`
      );

      if (walletRows.rows.length === 0) {
        throw new Error("No eligible wallets found for transfer");
      }

      for (const wallet of walletRows.rows) {
        const userEmail = wallet.email;
        const walletBalance = parseFloat(wallet.amount); // Ensure wallet balance is a float

        // Fetch the user's connected Stripe account ID
        const profileData = await trx.execute(
          dsql`SELECT stripe_account_id FROM profile WHERE email = ${userEmail}`
        );

        if (
          profileData.rows.length === 0 ||
          !profileData.rows[0].stripe_account_id
        ) {
          console.warn(`Stripe account not found for ${userEmail}`);
          continue; // Skip to the next wallet if no Stripe account is found
        }

        const stripeAccountId = profileData.rows[0].stripe_account_id;

        // Transfer the amount from the company's Stripe account to the user's Stripe account
        const transfer = await stripe.transfers.create({
          amount: Math.round(walletBalance * 100), // Convert float to the smallest currency unit
          currency: "usd", // or use the appropriate currency
          destination: stripeAccountId,
        });

        console.log(`Transfer successful for ${userEmail}:`, transfer.id);

        // Deduct the amount from the user's wallet
        const updatedBalance = 0.0; // Set the balance to zero after the transfer
        await trx.execute(
          dsql`UPDATE wallet SET amount = ${updatedBalance}, date = NOW() WHERE email = ${userEmail}`
        );

        // Log the transaction
        await trx.execute(
          dsql`INSERT INTO transactions (type, amount, email, "to", "from", message, transaction_id)
            VALUES (
              'transfer',
              ${walletBalance}, 
              ${userEmail},
              ${stripeAccountId},
              'company_account',
              ${
                "Transferred $" +
                walletBalance +
                " to Stripe account " +
                stripeAccountId
              },
              ${transfer.id}
            )`
        );

        console.log(`Transaction logged successfully for ${userEmail}`);
      }
    });

    return NextResponse.json({
      status: "success",
      message: "Funds transferred and wallet balances updated.",
    });
  } catch (error) {
    console.error("Error processing transactions:", error);
    return NextResponse.json({
      status: "failed",
      message: "Error processing transactions",
    });
  }
}
