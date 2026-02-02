/**
 * KeepAlive Durable Object
 * 
 * Pings the worker every 10 seconds to keep it warm and signing keys pre-loaded.
 * This prevents cold start delays when users access the auth endpoints.
 * 
 * The DO uses alarms (which can fire more frequently than cron triggers)
 * and a self-referencing service binding to make internal requests.
 */

import { DurableObject } from "cloudflare:workers"

// Interval between keep-alive pings (10 seconds)
const PING_INTERVAL_MS = 10_000

export class KeepAlive extends DurableObject<Env> {
  /**
   * Called when the cron trigger or an external request initializes the keep-alive loop.
   * Sets the first alarm to start the ping cycle.
   */
  async fetch(request: Request): Promise<Response> {
    // Check if alarm is already set
    const currentAlarm = await this.ctx.storage.getAlarm()
    
    if (currentAlarm === null) {
      // No alarm set, start the loop
      await this.ctx.storage.setAlarm(Date.now() + PING_INTERVAL_MS)
      console.log("KeepAlive: Started ping loop")
      return new Response(JSON.stringify({ status: "started", interval: PING_INTERVAL_MS }), {
        headers: { "Content-Type": "application/json" }
      })
    }
    
    // Already running
    return new Response(JSON.stringify({ status: "already_running", nextAlarm: currentAlarm }), {
      headers: { "Content-Type": "application/json" }
    })
  }

  /**
   * Called every 10 seconds by the alarm.
   * Pings the JWKS endpoint to trigger key loading, then sets the next alarm.
   */
  async alarm(): Promise<void> {
    try {
      // Use service binding to make internal request (doesn't go over public internet)
      const response = await this.env.SELF.fetch(
        new Request("https://internal/.well-known/jwks.json")
      )
      
      console.log("KeepAlive: Ping completed", { 
        status: response.status,
        time: new Date().toISOString()
      })
    } catch (error) {
      console.error("KeepAlive: Ping failed", error)
    }
    
    // Always set the next alarm, even if the ping failed
    await this.ctx.storage.setAlarm(Date.now() + PING_INTERVAL_MS)
  }
}
