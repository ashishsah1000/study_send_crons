import { NextResponse } from "next/server";
// import { getServerSession } from "next-auth";
import { drizzle } from "drizzle-orm/vercel-postgres";
import { sql as dsql } from "drizzle-orm";
import { sql } from "@vercel/postgres";

// Initialize Drizzle ORM with the client
const db = drizzle(sql);

export async function GET(request) {
  //   const session = await getServerSession({ request });

  //   if (!session) {
  //     return NextResponse.json(
  //       { data: "Unauthorized", status: "failed" },
  //       { status: 401 }
  //     );
  //   }

  try {
    // Fetch bookings with transaction_status = "processing"
    const bookingsQuery = dsql`
      SELECT id, amount, admin, transaction_id,topic
      FROM bookings 
      WHERE transaction_status = 'processing';
    `;
    const bookings = await db.execute(bookingsQuery);

    if (bookings.rows.length === 0) {
      return NextResponse.json(
        {
          status: "success",
          message: "No bookings with 'processing' transaction_status found",
        },
        { status: 200 }
      );
    }

    // Process each booking in a transaction
    await db.transaction(async (trx) => {
      for (const booking of bookings.rows) {
        const { id, amount, admin, transaction_id, topic } = booking;

        console.log(
          "Processing Booking ID: ",
          id,
          " Amount: ",
          amount,
          " admin: ",
          admin,
          " Transaction ID: ",
          transaction_id
        );

        // Fetch the current wallet balance of the admin
        const walletQuery = dsql`
          SELECT id, amount 
          FROM wallet 
          WHERE email = ${admin} AND currency = 'USD' LIMIT 1;
        `;
        const walletData = await trx.execute(walletQuery);

        let walletId, newBalance;
        if (walletData.rows.length > 0) {
          walletId = walletData.rows[0].id;
          newBalance =
            parseFloat(walletData.rows[0].amount) + parseFloat(amount); // Add booking amount to wallet
        } else {
          // If no wallet exists, create a new one with the amount
          newBalance = amount;
        }
        console.log("New Balance: ", newBalance);
        // Update or Insert into wallet
        if (walletId) {
          await trx.execute(
            dsql`UPDATE wallet 
                 SET amount = ${newBalance} 
                 WHERE id = ${walletId}`
          );
        } else {
          await trx.execute(
            dsql`INSERT INTO wallet (amount, currency, status, email) 
                 VALUES (${newBalance}, 'USD', 'active', ${admin})`
          );
        }

        // Insert transaction record
        await trx.execute(
          dsql`INSERT INTO transactions (date,transaction_id, type, amount, email, "to", "from", message) 
               VALUES (
                 NOW(), 
                 ${`to_wallet_${transaction_id}`},
                 'credit', 
                 ${amount}, 
                 ${admin}, 
                 'wallet', 
                 'system', 
                 ${"Credited $" + amount + `for booking completion ${topic}`}
               )`
        );

        // Update booking's transaction_status to "completed"
        await trx.execute(
          dsql`UPDATE bookings 
               SET transaction_status = 'completed' 
               WHERE id = ${id}`
        );

        console.log(
          "Booking ID: ",
          id,
          " updated to transaction_status: 'completed'"
        );
      }
    });

    return NextResponse.json(
      {
        status: "success",
        message:
          "Transactions processed and transaction_status updated to 'completed'",
      },
      { status: 200 }
    );
  } catch (error) {
    console.log("Error processing transactions", error);
    return NextResponse.json(
      {
        status: "failed",
        message: "Failed to process transactions",
      },
      { status: 500 }
    );
  }
}
