import { NextResponse } from "next/server";

import { sql } from "@vercel/postgres";
import { drizzle } from "drizzle-orm/vercel-postgres";
import { sql as dsql } from "drizzle-orm";

// 1st cron job to run
// check the bookings transaction_status in bookings where it is "unavailable"
// check if the joinne has joined the meeting or not and meeting_status == "created" || "completed"
// if the joinee has joined and meeting_status is created then update the meeting_status to "completed"
// and update the transaction_status to "processing" in bookings

// Initialize Drizzle ORM with the client
const db = drizzle(sql);

export async function GET(request) {
  try {
    // Query to find bookings with "unavailable" transaction_status
    const bookingsQuery = dsql`
        SELECT id, meeting_status, joined_by 
        FROM bookings 
        WHERE transaction_status = 'unavailable';
      `;

    // Execute the query
    const bookings = await db.execute(bookingsQuery);

    if (bookings.rows.length > 0) {
      await db.transaction(async (trx) => {
        // Loop through the bookings to check meeting status and joinee's participation
        for (const booking of bookings.rows) {
          const { id, meeting_status, joined_by } = booking;

          console.log(
            "processing Booking ID: ",
            id,
            " meeting_status: ",
            meeting_status,
            " joined_by: ",
            joined_by
          );

          // Check if the joinee has joined and meeting status is "created" or "completed"
          if (
            joined_by &&
            (meeting_status === "created" || meeting_status === "completed")
          ) {
            // If the joinee has joined and meeting_status is "created", update to "completed"
            let newMeetingStatus = meeting_status;
            if (meeting_status === "created") {
              newMeetingStatus = "completed";
            }

            // Update the meeting_status and transaction_status
            await trx.execute(
              dsql`UPDATE bookings 
                     SET meeting_status = ${newMeetingStatus}, 
                         transaction_status = 'processing' 
                     WHERE id = ${id}`
            );

            console.log(
              "Booking ID: ",
              id,
              " updated to meeting_status: ",
              newMeetingStatus,
              " and transaction_status: processing"
            );
          }
        }
      });

      return NextResponse.json(
        {
          status: "success",
          message: "Bookings updated successfully",
        },
        { status: 200 }
      );
    } else {
      return NextResponse.json(
        {
          status: "success",
          message: "No bookings with 'unavailable' transaction_status found",
        },
        { status: 200 }
      );
    }
  } catch (error) {
    console.log("Error updating bookings", error);
    return NextResponse.json(
      {
        status: "failed",
        message: "Failed to update bookings",
      },
      { status: 500 }
    );
  }
}
