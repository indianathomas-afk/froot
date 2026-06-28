import { PrismaClient } from '@prisma/client'
import { PrismaNeon } from '@prisma/adapter-neon'
import { neonConfig } from '@neondatabase/serverless'
import ws from 'ws'
import * as dotenv from 'dotenv'

dotenv.config()

neonConfig.webSocketConstructor = ws

const adapter = new PrismaNeon({ connectionString: process.env.DATABASE_URL! })
const prisma = new PrismaClient({ adapter })
const TARGET_ORG_ID = 'cf888f2d-f234-48c7-8097-fd5b44b5b3dd'
const isRollback = process.argv.includes('--rollback')

// ─── Template Data ────────────────────────────────────────────────────────────

const TEMPLATES_DATA = [
  {
    name: "Opener Checklist",
    description: "Opening shift responsibilities including setup, safety checks, and store preparation",
    type: "Opener",
    availabilityType: "StoreHours",
    operationalPhase: "Before Opening",
    startOffsetHours: 1,
    endOffsetHours: 2,
    tasks: [
      { section: "Store Opening", time: 3, description: "Turn on all lights in the store", photo: false, temp: false, critical: false },
      { section: "Store Opening", time: 1, description: "Pull up window blinds if they are down", photo: false, temp: false, critical: false },
      { section: "Store Opening", time: 2, description: "Put Portable Graphic Sign Outside near the front door", photo: false, temp: false, critical: false },
      { section: "Store Opening", time: 5, description: "Turn on monitors so menus are displayed", photo: false, temp: false, critical: false },
      { section: "Store Opening", time: 3, description: "Turn on music, volume should not be too loud. Music is for background noise. Do not change station without authorization", photo: false, temp: false, critical: false },
      { section: "Store Opening", time: 2, description: "Turn on OPEN sign 5 minutes before posted opening time", photo: false, temp: false, critical: false },
      { section: "Store Opening", time: 5, description: "Check and Ensure Kiosk is powered up and working", photo: false, temp: false, critical: false },
      { section: "Store Opening", time: 5, description: "If digital monitors are acting up follow instructions in training guide", photo: false, temp: false, critical: false },
      { section: "Store Opening", time: 5, description: "Is Petty Cash accurate? Count petty cash and make sure it is at $300", photo: false, temp: false, critical: false },
      { section: "Store Opening", time: 5, description: "Count the drawer to verify how much money is in it and enter that number in the POS system", photo: false, temp: false, critical: false },
      { section: "Store Opening", time: 5, description: "FRAUD PREVENTION: Ensure all open tickets in the register are cleared", photo: false, temp: false, critical: false },
      { section: "Store Opening", time: 5, description: "Turn on Honey Dispenser - DO NOT GO ABOVE 100 DEGREES", photo: false, temp: false, critical: false },
      { section: "Store Opening", time: 5, description: "Screw the juice nozzles back into the juice machine", photo: false, temp: false, critical: false },
      { section: "Store Opening", time: 5, description: "ENSURE bubbler cooling switch IS ON at start of shift. Warm juice risks customer safety", photo: false, temp: false, critical: false },
      { section: "Store Opening", time: 5, description: "Place Boba set up next to ice bin, fill with ice", photo: false, temp: false, critical: false },
      { section: "Store Opening", time: 5, description: "Pull syrup pumps from fridge for Tahoe lemonade", photo: false, temp: false, critical: false },
      { section: "Store Opening", time: 5, description: "Fill three-compartment sink - Left side: 1 cap of soap and warm water", photo: false, temp: false, critical: false },
      { section: "Store Opening", time: 5, description: "Fill three-compartment sink - Right side: 1 cap of bleach and cold water", photo: false, temp: false, critical: false },
      { section: "Store Opening", time: 5, description: "Set up bleach buckets with towels", photo: false, temp: false, critical: false },
      { section: "Store Opening", time: 5, description: "Prep cutting boards and knives - Take them out of dipping cabinet and place on counters", photo: false, temp: false, critical: false },
      { section: "Store Opening", time: 5, description: "Turn on Pretzel Warmer", photo: false, temp: false, critical: false },
      { section: "Store Opening", time: 5, description: "Check if bathroom needs toilet paper or paper towels", photo: false, temp: false, critical: false },
      { section: "Store Opening", time: 5, description: "Make sure bathroom is clean and smells good", photo: false, temp: false, critical: false },
      { section: "Store Opening", time: 5, description: "Take a picture of the lobby to show it is clean and ready for customers", photo: true, temp: false, critical: false },
      { section: "Prep & Restocking", time: 5, description: "Check Prep List - What needs to be prepped today?", photo: false, temp: false, critical: false },
      { section: "Prep & Restocking", time: 5, description: "Check bananas - do they need to be pulled from boxes?", photo: false, temp: false, critical: false },
      { section: "Prep & Restocking", time: 5, description: "Check juice levels - Do any need to be swapped?", photo: false, temp: false, critical: false },
      { section: "Prep & Restocking", time: 5, description: "Check all stations - do any need to be restocked?", photo: false, temp: false, critical: false },
      { section: "Prep & Restocking", time: 5, description: "Check ice bin - does it need to be filled?", photo: false, temp: false, critical: false },
      { section: "Prep & Restocking", time: 5, description: "Check cups, lids, straws - do they need to be restocked?", photo: false, temp: false, critical: false },
      { section: "Prep & Restocking", time: 5, description: "Check trash cans - do they need to be emptied?", photo: false, temp: false, critical: false },
      { section: "Temperature & Safety", time: 5, description: "Check temperature of dipping cabinet", photo: false, temp: true, critical: true },
      { section: "Temperature & Safety", time: 5, description: "Check temperature of under counter fridge", photo: false, temp: true, critical: true },
      { section: "Temperature & Safety", time: 5, description: "Check temperature of walk-in fridge", photo: false, temp: true, critical: true },
      { section: "Temperature & Safety", time: 5, description: "Check temperature of walk-in freezer", photo: false, temp: true, critical: true },
      { section: "Temperature & Safety", time: 5, description: "Check temperature of bubbler", photo: false, temp: true, critical: true },
      { section: "Temperature & Safety", time: 5, description: "Check temperature of pretzel warmer", photo: false, temp: true, critical: true },
      { section: "Temperature & Safety", time: 5, description: "Check temperature of honey dispenser", photo: false, temp: true, critical: true },
      { section: "Temperature & Safety", time: 5, description: "Check temperature of hot water at 3-comp sink", photo: false, temp: true, critical: true },
      { section: "Temperature & Safety", time: 5, description: "Check temperature of hot water at hand sink", photo: false, temp: true, critical: true },
      { section: "Temperature & Safety", time: 5, description: "Check temperature of hot water at bathroom sink", photo: false, temp: true, critical: true },
      { section: "Temperature & Safety", time: 5, description: "Check temperature of hot water at mop sink", photo: false, temp: true, critical: true },
      { section: "Temperature & Safety", time: 5, description: "Check temperature of hot water at dish machine", photo: false, temp: true, critical: true },
      { section: "Temperature & Safety", time: 5, description: "Check temperature of hot water at prep sink", photo: false, temp: true, critical: true },
      { section: "Temperature & Safety", time: 5, description: "Check temperature of hot water at bar sink", photo: false, temp: true, critical: true },
      { section: "Temperature & Safety", time: 5, description: "Check temperature of hot water at wait station sink", photo: false, temp: true, critical: true },
      { section: "Temperature & Safety", time: 5, description: "Check temperature of hot water at server station sink", photo: false, temp: true, critical: true },
      { section: "Temperature & Safety", time: 5, description: "Check temperature of hot water at bus station sink", photo: false, temp: true, critical: true },
    ]
  },
  {
    name: "Mid-Shift Checklist",
    description: "Mid-day responsibilities including restocking, cleaning, and quality checks",
    type: "Mid-Shift",
    availabilityType: "StoreHours",
    operationalPhase: "During Hours",
    startOffsetHours: 2,
    endOffsetHours: 2,
    tasks: [
      { section: "Cleaning", time: 5, description: "Wipe down all counters and tables in lobby", photo: false, temp: false, critical: false },
      { section: "Cleaning", time: 5, description: "Sweep lobby floor", photo: false, temp: false, critical: false },
      { section: "Cleaning", time: 5, description: "Mop lobby floor if needed", photo: false, temp: false, critical: false },
      { section: "Cleaning", time: 5, description: "Empty lobby trash cans", photo: false, temp: false, critical: false },
      { section: "Cleaning", time: 5, description: "Clean bathroom - wipe down sink, toilet, mirror", photo: false, temp: false, critical: false },
      { section: "Cleaning", time: 5, description: "Sweep bathroom floor", photo: false, temp: false, critical: false },
      { section: "Cleaning", time: 5, description: "Mop bathroom floor", photo: false, temp: false, critical: false },
      { section: "Cleaning", time: 5, description: "Empty bathroom trash can", photo: false, temp: false, critical: false },
      { section: "Cleaning", time: 5, description: "Wipe down all counters and equipment in back of house", photo: false, temp: false, critical: false },
      { section: "Cleaning", time: 5, description: "Sweep back of house floor", photo: false, temp: false, critical: false },
      { section: "Cleaning", time: 5, description: "Mop back of house floor", photo: false, temp: false, critical: false },
      { section: "Cleaning", time: 5, description: "Empty back of house trash cans", photo: false, temp: false, critical: false },
      { section: "Restocking", time: 5, description: "Restock cups, lids, straws", photo: false, temp: false, critical: false },
      { section: "Restocking", time: 5, description: "Restock napkins, utensils", photo: false, temp: false, critical: false },
      { section: "Restocking", time: 5, description: "Restock all fruit and rotate correctly.", photo: false, temp: false, critical: false },
      { section: "Restocking", time: 5, description: "Consistently stock straws, napkins, cups, and lids throughout day", photo: false, temp: false, critical: false },
      { section: "Restocking", time: 5, description: "Stock cups if necessary - DO NOT OVERSTOCK CUPS", photo: false, temp: false, critical: false },
      { section: "Stocking", time: 5, description: "Ensure proper stock of Spinach & Kale bins in prep counter", photo: true, temp: false, critical: false },
      { section: "Stocking", time: 5, description: "Restock any of the blend in/topping stations", photo: true, temp: false, critical: false },
      { section: "Stocking", time: 2, description: "Stock cheese cups in the warmer for pretzel orders - NEVER SERVE cold cheese", photo: false, temp: false, critical: false },
      { section: "Inventory Checks", time: 2, description: "Check pretzel inventory - make sure we are stocked on all baked goods", photo: false, temp: false, critical: false },
      { section: "Inventory Checks", time: 3, description: "Check proper stock of baked goods, pretzels and pastries in the front of the store", photo: false, temp: false, critical: false },
      { section: "Inventory Checks", time: 2, description: "PRETZEL BITES / PASTRIES - Confirm stock in nearest front production freezer/dipping cabinet", photo: false, temp: false, critical: false },
      { section: "Inventory Checks", time: 2, description: "Make a note and check juice cartridge levels to see if any might be out soon", photo: false, temp: false, critical: false },
      { section: "Inventory Checks", time: 3, description: "Message Managers from the iPad about any out of stock or low stock items", photo: false, temp: false, critical: false },
      { section: "Inventory Checks", time: 5, description: "Check all stations and stock if necessary", photo: false, temp: false, critical: false },
      { section: "Temperature & Safety", time: 2, description: "Make sure refrigerator temperature is 35-40 degrees", photo: false, temp: true, critical: true },
      { section: "Temperature & Safety", time: 1, description: "Make sure freezer temperature is 0-10 degrees", photo: false, temp: true, critical: true },
      { section: "Temperature & Safety", time: 5, description: "Verify fresh fruit in the under counter fridge is not moldy or over ripe. Freeze any fruit that is turning overly ripe", photo: true, temp: false, critical: false },
      { section: "Temperature & Safety", time: 5, description: "Verify fresh fruit in the under walk in or three-door fridge is not moldy or over ripe. Freeze any fruit that is turning overly ripe", photo: true, temp: false, critical: true },
      { section: "Temperature & Safety", time: 5, description: "Verify that BANANAS are uncovered in their boxes (no spotted bananas)", photo: false, temp: false, critical: false },
    ]
  },
  {
    name: "Closer Checklist",
    description: "Closing shift responsibilities including final cleanup, cash handling, and securing the store",
    type: "Closer",
    availabilityType: "StoreHours",
    operationalPhase: "After Closing",
    startOffsetHours: 1,
    endOffsetHours: 2,
    tasks: [
      { section: "Cash & Register", time: 5, description: "Is Petty Cash accurate? Count petty cash and make sure it is at $300", photo: false, temp: false, critical: false },
      { section: "Cash & Register", time: 5, description: "Count the drawer and record the amount", photo: false, temp: false, critical: false },
      { section: "Cash & Register", time: 5, description: "FRAUD PREVENTION: Ensure all open tickets in the register are cleared", photo: false, temp: false, critical: false },
      { section: "Cash & Register", time: 5, description: "Run end of day report on POS system", photo: false, temp: false, critical: false },
      { section: "Cash & Register", time: 5, description: "Drop cash in safe", photo: false, temp: false, critical: false },
      { section: "Equipment Shutdown", time: 5, description: "Turn off Honey Dispenser", photo: false, temp: false, critical: false },
      { section: "Equipment Shutdown", time: 5, description: "Remove juice nozzles from juice machine and place in dipping cabinet to soak", photo: false, temp: false, critical: false },
      { section: "Equipment Shutdown", time: 5, description: "Turn off bubbler cooling switch", photo: false, temp: false, critical: false },
      { section: "Equipment Shutdown", time: 5, description: "Turn off Pretzel Warmer", photo: false, temp: false, critical: false },
      { section: "Equipment Shutdown", time: 5, description: "Turn off monitors", photo: false, temp: false, critical: false },
      { section: "Equipment Shutdown", time: 5, description: "Turn off music", photo: false, temp: false, critical: false },
      { section: "Equipment Shutdown", time: 5, description: "Turn off OPEN sign", photo: false, temp: false, critical: false },
      { section: "Equipment Shutdown", time: 5, description: "Turn off all lights", photo: false, temp: false, critical: false },
      { section: "Cleaning", time: 5, description: "Wipe down all counters and equipment", photo: false, temp: false, critical: false },
      { section: "Cleaning", time: 5, description: "Sweep and mop all floors", photo: false, temp: false, critical: false },
      { section: "Cleaning", time: 5, description: "Empty all trash cans and replace liners", photo: false, temp: false, critical: false },
      { section: "Cleaning", time: 5, description: "Clean and sanitize all food prep surfaces", photo: false, temp: false, critical: false },
      { section: "Cleaning", time: 5, description: "Clean bathroom thoroughly", photo: false, temp: false, critical: false },
      { section: "Cleaning", time: 5, description: "Drain and clean three-compartment sink", photo: false, temp: false, critical: false },
      { section: "Cleaning", time: 5, description: "Put away all cutting boards and knives in dipping cabinet to soak", photo: false, temp: false, critical: false },
      { section: "Closing Checks", time: 5, description: "Bring in Portable Graphic Sign from outside", photo: false, temp: false, critical: false },
      { section: "Closing Checks", time: 5, description: "Lock front door", photo: false, temp: false, critical: false },
      { section: "Closing Checks", time: 5, description: "Check all windows are closed and locked", photo: false, temp: false, critical: false },
      { section: "Closing Checks", time: 5, description: "Take a picture of the lobby to show it is clean and closed", photo: true, temp: false, critical: false },
      { section: "Closing Checks", time: 5, description: "Set alarm before leaving", photo: false, temp: false, critical: true },
      { section: "Temperature & Safety", time: 5, description: "Check temperature of dipping cabinet before leaving", photo: false, temp: true, critical: true },
      { section: "Temperature & Safety", time: 5, description: "Check temperature of walk-in fridge before leaving", photo: false, temp: true, critical: true },
      { section: "Temperature & Safety", time: 5, description: "Check temperature of walk-in freezer before leaving", photo: false, temp: true, critical: true },
    ]
  },
  {
    name: "Cleaning Checklist",
    description: "Deep cleaning tasks for maintaining store hygiene and health code compliance",
    type: "Cleaning",
    availabilityType: "AllDay",
    operationalPhase: null as string | null,
    startOffsetHours: null as number | null,
    endOffsetHours: null as number | null,
    tasks: [
      { section: "Front of House", time: 5, description: "Wipe down all tables and chairs in lobby", photo: false, temp: false, critical: false },
      { section: "Front of House", time: 5, description: "Clean and sanitize all customer-facing counters", photo: false, temp: false, critical: false },
      { section: "Front of House", time: 5, description: "Wipe down menu boards and displays", photo: false, temp: false, critical: false },
      { section: "Front of House", time: 5, description: "Clean windows and glass doors", photo: false, temp: false, critical: false },
      { section: "Front of House", time: 5, description: "Sweep and mop lobby floor", photo: false, temp: false, critical: false },
      { section: "Front of House", time: 5, description: "Empty and sanitize trash cans", photo: false, temp: false, critical: false },
      { section: "Front of House", time: 5, description: "Wipe down kiosk screen and stand", photo: false, temp: false, critical: false },
      { section: "Back of House", time: 5, description: "Clean and sanitize all prep surfaces", photo: false, temp: false, critical: false },
      { section: "Back of House", time: 5, description: "Clean juice machine - wipe down exterior", photo: false, temp: false, critical: false },
      { section: "Back of House", time: 5, description: "Clean and sanitize blenders", photo: false, temp: false, critical: false },
      { section: "Back of House", time: 5, description: "Wipe down all equipment exteriors", photo: false, temp: false, critical: false },
      { section: "Back of House", time: 5, description: "Sweep and mop back of house floor", photo: false, temp: false, critical: false },
      { section: "Back of House", time: 5, description: "Empty and sanitize back of house trash cans", photo: false, temp: false, critical: false },
      { section: "Back of House", time: 5, description: "Clean and organize under-counter storage", photo: false, temp: false, critical: false },
      { section: "Equipment Deep Clean", time: 10, description: "Deep clean juice machine nozzles and components", photo: false, temp: false, critical: true },
      { section: "Equipment Deep Clean", time: 10, description: "Deep clean blender cups and lids", photo: false, temp: false, critical: false },
      { section: "Equipment Deep Clean", time: 10, description: "Clean pretzel warmer interior and exterior", photo: false, temp: false, critical: false },
      { section: "Equipment Deep Clean", time: 10, description: "Clean honey dispenser - inside and outside", photo: false, temp: false, critical: false },
      { section: "Equipment Deep Clean", time: 10, description: "Clean dipping cabinet interior", photo: false, temp: false, critical: false },
      { section: "Equipment Deep Clean", time: 5, description: "Wipe down all refrigerator door handles and exteriors", photo: false, temp: false, critical: false },
      { section: "Bathroom", time: 5, description: "Scrub toilet bowl and seat", photo: false, temp: false, critical: false },
      { section: "Bathroom", time: 5, description: "Clean and disinfect sink and faucet", photo: false, temp: false, critical: false },
      { section: "Bathroom", time: 5, description: "Clean mirror", photo: false, temp: false, critical: false },
      { section: "Bathroom", time: 5, description: "Sweep and mop bathroom floor", photo: false, temp: false, critical: false },
      { section: "Bathroom", time: 5, description: "Restock toilet paper, paper towels, and soap", photo: false, temp: false, critical: false },
      { section: "Bathroom", time: 5, description: "Empty and sanitize bathroom trash can", photo: false, temp: false, critical: false },
      { section: "Sinks & Drains", time: 5, description: "Clean three-compartment sink - scrub all three basins", photo: false, temp: false, critical: false },
      { section: "Sinks & Drains", time: 5, description: "Clean and sanitize hand sink", photo: false, temp: false, critical: false },
      { section: "Sinks & Drains", time: 5, description: "Clean floor drains - remove debris and sanitize", photo: false, temp: false, critical: true },
      { section: "Sinks & Drains", time: 5, description: "Clean mop sink", photo: false, temp: false, critical: false },
      { section: "Walk-In & Storage", time: 5, description: "Sweep walk-in fridge floor", photo: false, temp: false, critical: false },
      { section: "Walk-In & Storage", time: 5, description: "Wipe down walk-in fridge shelves", photo: false, temp: false, critical: false },
      { section: "Walk-In & Storage", time: 5, description: "Sweep walk-in freezer floor", photo: false, temp: false, critical: false },
      { section: "Walk-In & Storage", time: 5, description: "Organize dry storage area", photo: false, temp: false, critical: false },
      { section: "Walk-In & Storage", time: 5, description: "Check for expired products and discard", photo: false, temp: false, critical: true },
      { section: "Final Inspection", time: 5, description: "Take photo of clean lobby", photo: true, temp: false, critical: false },
      { section: "Final Inspection", time: 5, description: "Take photo of clean back of house", photo: true, temp: false, critical: false },
      { section: "Final Inspection", time: 5, description: "Take photo of clean bathroom", photo: true, temp: false, critical: false },
      { section: "Final Inspection", time: 5, description: "Verify all cleaning supplies are restocked and stored properly", photo: false, temp: false, critical: false },
      { section: "Final Inspection", time: 5, description: "Sign off that cleaning checklist is complete", photo: false, temp: false, critical: false },
    ]
  },
  {
    name: "Management Tasks",
    description: "Daily management responsibilities including ordering, reporting, and team oversight",
    type: "Management",
    availabilityType: "AllDay",
    operationalPhase: null as string | null,
    startOffsetHours: null as number | null,
    endOffsetHours: null as number | null,
    tasks: [
      { section: "Opening Management", time: 5, description: "Review previous day's sales report", photo: false, temp: false, critical: false },
      { section: "Opening Management", time: 5, description: "Check staffing schedule for the day - are all shifts covered?", photo: false, temp: false, critical: false },
      { section: "Opening Management", time: 5, description: "Review any notes or issues from previous shift", photo: false, temp: false, critical: false },
      { section: "Opening Management", time: 5, description: "Check email and respond to any urgent messages", photo: false, temp: false, critical: false },
      { section: "Ordering & Inventory", time: 10, description: "Review inventory levels and place orders as needed", photo: false, temp: false, critical: false },
      { section: "Ordering & Inventory", time: 5, description: "Check produce delivery - verify quantities and quality", photo: false, temp: false, critical: true },
      { section: "Ordering & Inventory", time: 5, description: "Verify all deliveries match purchase orders", photo: false, temp: false, critical: false },
      { section: "Ordering & Inventory", time: 5, description: "Update inventory spreadsheet with current counts", photo: false, temp: false, critical: false },
      { section: "Team Management", time: 5, description: "Conduct brief team huddle at start of shift", photo: false, temp: false, critical: false },
      { section: "Team Management", time: 5, description: "Review any performance issues or coaching opportunities", photo: false, temp: false, critical: false },
      { section: "Team Management", time: 5, description: "Ensure all team members are in proper uniform", photo: false, temp: false, critical: false },
      { section: "Team Management", time: 5, description: "Verify all team members have completed required training", photo: false, temp: false, critical: false },
      { section: "Operations", time: 5, description: "Walk the store and identify any maintenance issues", photo: false, temp: false, critical: false },
      { section: "Operations", time: 5, description: "Check all equipment is functioning properly", photo: false, temp: false, critical: true },
      { section: "Operations", time: 5, description: "Review customer feedback from previous day", photo: false, temp: false, critical: false },
      { section: "Operations", time: 5, description: "Check online reviews and respond if necessary", photo: false, temp: false, critical: false },
      { section: "Closing Management", time: 5, description: "Review day's sales performance vs. target", photo: false, temp: false, critical: false },
      { section: "Closing Management", time: 5, description: "Complete end of day report", photo: false, temp: false, critical: false },
      { section: "Closing Management", time: 5, description: "Verify cash drawer reconciliation", photo: false, temp: false, critical: true },
      { section: "Closing Management", time: 5, description: "Send daily summary report to area manager", photo: false, temp: false, critical: false },
      { section: "Closing Management", time: 5, description: "Prepare notes for opening manager tomorrow", photo: false, temp: false, critical: false },
      { section: "Closing Management", time: 5, description: "Confirm schedule for next day is posted and communicated", photo: false, temp: false, critical: false },
    ]
  },
  {
    name: "Coffee Checklist",
    description: "Coffee station setup, maintenance, and quality control procedures",
    type: "Coffee",
    availabilityType: "StoreHours",
    operationalPhase: "Before Opening",
    startOffsetHours: 1,
    endOffsetHours: 1,
    tasks: [
      { section: "Coffee Setup", time: 5, description: "Turn on espresso machine and allow to warm up (15 minutes)", photo: false, temp: false, critical: true },
      { section: "Coffee Setup", time: 5, description: "Grind fresh coffee beans for the day", photo: false, temp: false, critical: false },
      { section: "Coffee Setup", time: 5, description: "Brew first pot of drip coffee", photo: false, temp: false, critical: false },
      { section: "Coffee Setup", time: 5, description: "Stock coffee cups, lids, and sleeves", photo: false, temp: false, critical: false },
      { section: "Coffee Setup", time: 5, description: "Stock syrups and sauces at coffee station", photo: false, temp: false, critical: false },
      { section: "Coffee Setup", time: 5, description: "Fill milk pitchers and refrigerate", photo: false, temp: false, critical: false },
      { section: "Coffee Quality", time: 5, description: "Pull a test shot of espresso - check color, crema, and timing", photo: false, temp: false, critical: true },
      { section: "Coffee Quality", time: 5, description: "Steam milk test - check texture and temperature (150-160°F)", photo: false, temp: true, critical: true },
      { section: "Coffee Quality", time: 5, description: "Taste test drip coffee - should be fresh and properly brewed", photo: false, temp: false, critical: false },
      { section: "Coffee Cleaning", time: 5, description: "Backflush espresso machine", photo: false, temp: false, critical: false },
      { section: "Coffee Cleaning", time: 5, description: "Wipe down espresso machine exterior", photo: false, temp: false, critical: false },
      { section: "Coffee Cleaning", time: 5, description: "Clean steam wand after each use", photo: false, temp: false, critical: true },
      { section: "Coffee Cleaning", time: 5, description: "Empty and rinse drip coffee carafes", photo: false, temp: false, critical: false },
      { section: "Coffee Cleaning", time: 5, description: "Wipe down coffee station counter", photo: false, temp: false, critical: false },
      { section: "Coffee Closing", time: 5, description: "Turn off espresso machine following shutdown procedure", photo: false, temp: false, critical: false },
      { section: "Coffee Closing", time: 5, description: "Deep clean espresso machine group heads", photo: false, temp: false, critical: false },
    ]
  },
  {
    name: "Berries & Bouquets",
    description: "Production checklist for Berries & Bouquets chocolate-dipped strawberry orders",
    type: "Berries",
    availabilityType: "AllDay",
    operationalPhase: null as string | null,
    startOffsetHours: null as number | null,
    endOffsetHours: null as number | null,
    tasks: [
      { section: "Order Management", time: 5, description: "Check that printer is turned on and printing orders", photo: false, temp: false, critical: false },
      { section: "Order Management", time: 5, description: "Check orders for the day - how many are scheduled?", photo: false, temp: false, critical: false },
      { section: "Order Management", time: 5, description: "Make sure that the tickets you have match the amount of orders scheduled for today", photo: false, temp: false, critical: false },
      { section: "Order Management", time: 5, description: "Check BMS messages - How many are there? Mark them as read unless they need responded to", photo: false, temp: false, critical: false },
      { section: "Order Management", time: 5, description: "HOW TO respond to messages in BMS - Follow procedure", photo: false, temp: false, critical: false },
      { section: "Order Management", time: 5, description: "Are there any orders that DOORDASH screwed up on and we need to call to receive credit?", photo: false, temp: false, critical: false },
      { section: "Order Management", time: 5, description: "How many orders did DOORDASH mess up? Call DOORDASH & get credit, then do the same in BMS", photo: false, temp: false, critical: false },
      { section: "Order Management", time: 5, description: "ENSURE ALL ORDERS HAVE BEEN ROUTED FOR DELIVERY", photo: false, temp: false, critical: false },
      { section: "Order Management", time: 5, description: "BE SMART AND PREP ORDERS AS NECESSARY - ROUTE THEM AFTER", photo: false, temp: false, critical: false },
      { section: "Production", time: 5, description: "CHOCOLATE WARMER PROCEDURE - Follow instructions", photo: false, temp: false, critical: false },
      { section: "Production", time: 5, description: "Set a timer for the chocolate warmer - turn the knob back to 35-40 so it does not scorch", photo: false, temp: false, critical: false },
      { section: "Production", time: 5, description: "Strawberry Waste Procedure - Follow instructions", photo: false, temp: false, critical: false },
      { section: "Production", time: 5, description: "Berries & Bouquet Box Assembly - Follow instructions", photo: false, temp: false, critical: false },
      { section: "Production", time: 5, description: "Verify prepped boxes inventory", photo: false, temp: false, critical: false },
      { section: "Production", time: 5, description: "Take BEFORE/AFTER photos of ALL items made today", photo: true, temp: false, critical: false },
      { section: "Production", time: 5, description: "Chocolate melts must be SEALED and not open or exposed", photo: false, temp: false, critical: false },
      { section: "Production", time: 5, description: "All sprinkles, toppings, chocolate chips, toffee, etc, MUST BE CLOSED AND SEALED", photo: false, temp: false, critical: false },
      { section: "Production", time: 5, description: "MAKE SURE LEFT OVER CHOCOLATE IS STORED AWAY in glass container", photo: false, temp: false, critical: false },
      { section: "Production", time: 5, description: "TURN OFF CHOCOLATE WARMER IF USED TODAY", photo: false, temp: false, critical: false },
      { section: "Production", time: 5, description: "ENSURE AREA IS CLEAN after production", photo: false, temp: false, critical: false },
      { section: "Production", time: 5, description: "Wash all chocolate dishes", photo: false, temp: false, critical: false },
      { section: "Production", time: 5, description: "Put all chocolate dishes away", photo: false, temp: false, critical: false },
      { section: "Production", time: 5, description: "Wipe down chocolate warmer", photo: false, temp: false, critical: false },
      { section: "Production", time: 5, description: "Take out trash", photo: false, temp: false, critical: false },
    ]
  },
  {
    name: "Peet's Coffee",
    description: "Checklist for Peet's Coffee station procedures",
    type: "Peet's Coffee",
    availabilityType: "StoreHours",
    operationalPhase: "Before Opening",
    startOffsetHours: 1,
    endOffsetHours: 1,
    tasks: [
      { section: "Coffee Prep", time: 5, description: "Brew pot of coffee", photo: false, temp: false, critical: false },
    ]
  },
]

// ─── Rollback ─────────────────────────────────────────────────────────────────

async function rollback() {
  const names = TEMPLATES_DATA.map(t => t.name)
  const deleted = await prisma.template.deleteMany({
    where: {
      organizationId: TARGET_ORG_ID,
      name: { in: names },
    },
  })
  console.log(`✓ Rollback complete: ${deleted.count} templates deleted (tasks cascade-deleted)`)
}

// ─── Import ───────────────────────────────────────────────────────────────────

async function importTemplates() {
  let templateCount = 0
  let taskCount = 0
  let skippedCount = 0

  for (const tmpl of TEMPLATES_DATA) {
    const existing = await prisma.template.findFirst({
      where: { organizationId: TARGET_ORG_ID, name: tmpl.name },
    })
    if (existing) {
      console.warn(`⚠ Skipped (already exists): "${tmpl.name}"`)
      skippedCount++
      continue
    }

    const created = await prisma.template.create({
      data: {
        organizationId: TARGET_ORG_ID,
        name: tmpl.name,
        description: tmpl.description,
        type: tmpl.type,
        frequency: 'Daily',
        availabilityType: tmpl.availabilityType,
        operationalPhase: tmpl.operationalPhase ?? null,
        startOffsetHours: tmpl.startOffsetHours ?? null,
        endOffsetHours: tmpl.endOffsetHours ?? null,
        isActive: true,
        tasks: {
          create: tmpl.tasks.map((task, index) => ({
            sectionName: task.section,
            description: task.description,
            estimatedTimeMinutes: task.time,
            requiresPhoto: task.photo,
            requiresTemp: task.temp,
            isCritical: task.critical,
            orderIndex: index,
            excludedStoreIds: [],
          })),
        },
      },
    })

    console.log(`✓ Created: "${created.name}" (${tmpl.tasks.length} tasks)`)
    templateCount++
    taskCount += tmpl.tasks.length
  }

  console.log(`\n✓ Import complete: ${templateCount} templates, ${taskCount} tasks created for organizationId ${TARGET_ORG_ID}`)
  if (skippedCount > 0) console.log(`  ${skippedCount} template(s) skipped (already existed)`)
}

// ─── Entry point ──────────────────────────────────────────────────────────────

async function main() {
  if (isRollback) {
    await rollback()
  } else {
    await importTemplates()
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect())
