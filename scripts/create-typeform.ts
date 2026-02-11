#!/usr/bin/env npx ts-node

/**
 * Creates the Tax Intake Form via Typeform API
 *
 * Usage:
 *   TYPEFORM_API_KEY=your_key npx ts-node scripts/create-typeform.ts
 *
 * Get your API key at: https://admin.typeform.com/user/tokens
 */

const TYPEFORM_API_KEY = process.env.TYPEFORM_API_KEY

if (!TYPEFORM_API_KEY) {
  console.error('Error: TYPEFORM_API_KEY environment variable is required')
  console.error('Get your API key at: https://admin.typeform.com/user/tokens')
  process.exit(1)
}

const formDefinition = {
  title: 'Tax Document Intake Form',
  settings: {
    language: 'en',
    is_public: true,
    progress_bar: 'proportion',
    show_progress_bar: true,
    meta: {
      allow_indexing: false
    }
  },
  welcome_screens: [
    {
      ref: 'welcome',
      title: "Let's gather some information to prepare your tax return.",
      properties: {
        description: 'This should take about 5 minutes.',
        show_button: true,
        button_text: 'Get Started'
      }
    }
  ],
  thankyou_screens: [
    {
      ref: 'thank_you',
      title: "Thanks! We'll review your responses and send you a list of documents to upload.",
      properties: {
        description: 'Check your email for next steps.',
        show_button: true,
        button_text: 'Visit Bodie',
        button_mode: 'redirect',
        redirect_url: 'https://getbodie.ai',
        share_icons: false
      }
    }
  ],
  // Hidden fields to capture URL parameters
  hidden: ['engagement_id'],

  fields: [
    // Q1: Filing Status
    {
      ref: 'filing_status',
      title: 'What is your filing status for this tax year?',
      type: 'multiple_choice',
      properties: {
        randomize: false,
        allow_multiple_selection: false,
        allow_other_choice: false,
        choices: [
          { ref: 'single', label: 'Single' },
          { ref: 'mfj', label: 'Married Filing Jointly' },
          { ref: 'mfs', label: 'Married Filing Separately' },
          { ref: 'hoh', label: 'Head of Household' },
          { ref: 'qss', label: 'Qualifying Surviving Spouse' }
        ]
      },
      validations: { required: true }
    },

    // Q2: Employment Type
    {
      ref: 'employment_type',
      title: 'How were you employed this year? (Select all that apply)',
      type: 'multiple_choice',
      properties: {
        randomize: false,
        allow_multiple_selection: true,
        allow_other_choice: false,
        choices: [
          { ref: 'w2', label: 'W-2 Employee (traditional job)' },
          { ref: 'self_employed', label: 'Self-employed / Freelancer / 1099 Contractor' },
          { ref: 'business_owner', label: 'Business Owner (LLC, S-Corp, Partnership)' },
          { ref: 'retired', label: 'Retired' },
          { ref: 'unemployed', label: 'Unemployed / Not Working' }
        ]
      },
      validations: { required: true }
    },

    // Q3: Number of W-2 jobs
    {
      ref: 'w2_count',
      title: 'How many W-2 jobs did you have?',
      type: 'number',
      properties: {
        description: 'Enter 0 if none'
      },
      validations: { required: true }
    },

    // Q4: Self-employment details
    {
      ref: 'self_employment_type',
      title: 'What type of self-employment income did you have? (Select all that apply)',
      type: 'multiple_choice',
      properties: {
        randomize: false,
        allow_multiple_selection: true,
        allow_other_choice: true,
        choices: [
          { ref: 'freelance', label: 'Freelance / Consulting' },
          { ref: 'gig', label: 'Gig work (Uber, DoorDash, etc.)' },
          { ref: 'online_sales', label: 'Online sales (Etsy, eBay, Amazon)' },
          { ref: 'str', label: 'Rental income (Airbnb, VRBO)' },
          { ref: 'content', label: 'Content creation (YouTube, streaming, etc.)' },
          { ref: 'none_se', label: 'None - not self-employed' }
        ]
      },
      validations: { required: true }
    },

    // Q5: Business expenses
    {
      ref: 'has_business_expenses',
      title: 'Did you have business expenses to deduct?',
      type: 'yes_no',
      validations: { required: true }
    },

    // Q6: Income types
    {
      ref: 'income_types',
      title: 'What other types of income did you receive? (Select all that apply)',
      type: 'multiple_choice',
      properties: {
        randomize: false,
        allow_multiple_selection: true,
        allow_other_choice: true,
        choices: [
          { ref: 'investment', label: 'Investment income (dividends, interest)' },
          { ref: 'sold_investments', label: 'Sold stocks, crypto, or other investments' },
          { ref: 'rental', label: 'Rental property income' },
          { ref: 'retirement_dist', label: 'Retirement distributions (401k, IRA, pension)' },
          { ref: 'social_security', label: 'Social Security benefits' },
          { ref: 'unemployment', label: 'Unemployment compensation' },
          { ref: 'gambling', label: 'Gambling winnings' },
          { ref: 'none_other', label: 'None of the above' }
        ]
      },
      validations: { required: true }
    },

    // Q7: Investment sales details
    {
      ref: 'investment_sales',
      title: 'Which investments did you sell? (Select all that apply)',
      type: 'multiple_choice',
      properties: {
        randomize: false,
        allow_multiple_selection: true,
        allow_other_choice: true,
        choices: [
          { ref: 'stocks', label: 'Stocks' },
          { ref: 'crypto', label: 'Cryptocurrency' },
          { ref: 'funds', label: 'Mutual funds / ETFs' },
          { ref: 'bonds', label: 'Bonds' },
          { ref: 'real_estate_inv', label: 'Real estate (not primary home)' },
          { ref: 'no_sales', label: 'Did not sell any investments' }
        ]
      },
      validations: { required: true }
    },

    // Q8: Real Estate
    {
      ref: 'real_estate',
      title: 'Do any of these apply to your real estate situation? (Select all that apply)',
      type: 'multiple_choice',
      properties: {
        randomize: false,
        allow_multiple_selection: true,
        allow_other_choice: false,
        choices: [
          { ref: 'own_home', label: 'I own my primary residence' },
          { ref: 'mortgage', label: 'I pay mortgage interest' },
          { ref: 'own_rental', label: 'I own rental property' },
          { ref: 'sold_home', label: 'I sold my home this year' },
          { ref: 'bought_home', label: 'I bought a home this year' },
          { ref: 'none_re', label: 'None of these apply' }
        ]
      },
      validations: { required: true }
    },

    // Q9: Life Events
    {
      ref: 'life_events',
      title: 'Did any of these major life events happen this year? (Select all that apply)',
      type: 'multiple_choice',
      properties: {
        randomize: false,
        allow_multiple_selection: true,
        allow_other_choice: false,
        choices: [
          { ref: 'married', label: 'Got married' },
          { ref: 'divorced', label: 'Got divorced' },
          { ref: 'child', label: 'Had or adopted a child' },
          { ref: 'college', label: 'Child started college' },
          { ref: 'moved', label: 'Moved to a different state' },
          { ref: 'started_biz', label: 'Started a business' },
          { ref: 'none_life', label: 'None of these' }
        ]
      },
      validations: { required: true }
    },

    // Q10: State residency
    {
      ref: 'states_lived',
      title: 'Which state(s) did you live in this year?',
      type: 'short_text',
      properties: {
        description: 'List all states, separated by commas (e.g., "California, Texas")'
      },
      validations: { required: true }
    },

    // Q11: Deductions
    {
      ref: 'deductions',
      title: 'Which of these expenses might you deduct? (Select all that apply)',
      type: 'multiple_choice',
      properties: {
        randomize: false,
        allow_multiple_selection: true,
        allow_other_choice: true,
        choices: [
          { ref: 'ded_mortgage', label: 'Mortgage interest' },
          { ref: 'ded_property', label: 'Property taxes' },
          { ref: 'ded_salt', label: 'State and local income taxes (SALT)' },
          { ref: 'ded_charity', label: 'Charitable donations' },
          { ref: 'ded_medical', label: 'Medical expenses' },
          { ref: 'ded_student', label: 'Student loan interest' },
          { ref: 'ded_childcare', label: 'Childcare / Dependent care' },
          { ref: 'ded_education', label: 'Education expenses (tuition, 529)' },
          { ref: 'ded_homeoffice', label: 'Home office expenses' },
          { ref: 'ded_hsa', label: 'Health Savings Account (HSA) contributions' },
          { ref: 'ded_ira', label: 'IRA contributions' },
          { ref: 'ded_standard', label: "I'll take the standard deduction" },
          { ref: 'ded_unsure', label: "I'm not sure" }
        ]
      },
      validations: { required: true }
    },

    // Q12: Estimated payments
    {
      ref: 'estimated_payments',
      title: 'Did you make estimated tax payments this year?',
      type: 'yes_no',
      validations: { required: true }
    },

    // Q13: Prior year issues
    {
      ref: 'prior_year',
      title: 'Any of these from prior years? (Select all that apply)',
      type: 'multiple_choice',
      properties: {
        randomize: false,
        allow_multiple_selection: true,
        allow_other_choice: false,
        choices: [
          { ref: 'cap_loss', label: 'Capital loss carryforward' },
          { ref: 'nol', label: 'Net operating loss (NOL) carryforward' },
          { ref: 'ftc', label: 'Foreign tax credit carryforward' },
          { ref: 'depreciation', label: 'Depreciation on rental/business property' },
          { ref: 'none_prior', label: 'None of these / Not sure' }
        ]
      },
      validations: { required: true }
    },

    // Q14: Foreign accounts
    {
      ref: 'foreign_accounts',
      title: 'Do you have any foreign financial accounts or assets? (Select all that apply)',
      type: 'multiple_choice',
      properties: {
        randomize: false,
        allow_multiple_selection: true,
        allow_other_choice: false,
        choices: [
          { ref: 'foreign_bank', label: 'Foreign bank accounts' },
          { ref: 'foreign_invest', label: 'Foreign investments or brokerage accounts' },
          { ref: 'foreign_retire', label: 'Foreign retirement accounts' },
          { ref: 'foreign_company', label: 'Ownership in foreign companies' },
          { ref: 'no_foreign', label: 'No foreign accounts or assets' }
        ]
      },
      validations: { required: true }
    },

    // Q15: Dependents
    {
      ref: 'dependents_count',
      title: 'How many dependents will you claim?',
      type: 'number',
      properties: {
        description: 'Include children and other qualifying dependents. Enter 0 if none.'
      },
      validations: { required: true }
    },

    // Q16: Additional notes
    {
      ref: 'additional_notes',
      title: "Anything else we should know about your tax situation?",
      type: 'long_text',
      properties: {
        description: 'Unusual circumstances, questions, concerns, etc.'
      },
      validations: { required: false }
    }
  ]
}

async function createForm() {
  console.log('Creating Tax Intake Form...\n')

  const response = await fetch('https://api.typeform.com/forms', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${TYPEFORM_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(formDefinition)
  })

  if (!response.ok) {
    const error = await response.json()
    console.error('Failed to create form:', JSON.stringify(error, null, 2))
    process.exit(1)
  }

  const form = await response.json()

  console.log('✓ Form created successfully!\n')
  console.log('Form ID:', form.id)
  console.log('Form URL:', form._links.display)
  console.log('\nAdd this to your .env:')
  console.log(`TYPEFORM_FORM_ID=${form.id}`)
  console.log('\nWebhook URL to configure in Typeform:')
  console.log(`${process.env.API_URL || 'https://your-api.onrender.com'}/webhooks/typeform`)
}

createForm().catch(console.error)
