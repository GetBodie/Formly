#!/usr/bin/env python3
"""Generate synthetic tax documents for eval testing."""

from reportlab.lib.pagesizes import letter
from reportlab.lib.units import inch
from reportlab.pdfgen import canvas
from reportlab.lib.colors import black, gray, lightgrey
import os

OUTPUT_DIR = "docs"

def draw_w2(c, employer_name, wages, employee_name="John Q. Taxpayer", 
            employee_ssn="XXX-XX-1234", ein="12-3456789", year="2024",
            is_blank=False, low_quality=False):
    """Draw a W-2 form."""
    width, height = letter
    
    # Title
    c.setFont("Helvetica-Bold", 16)
    c.drawString(1*inch, height - 0.75*inch, f"Form W-2 Wage and Tax Statement {year}")
    
    # Form border
    c.setStrokeColor(black)
    c.setLineWidth(2)
    c.rect(0.5*inch, 1*inch, width - 1*inch, height - 1.5*inch)
    
    # Grid lines
    c.setLineWidth(0.5)
    y_positions = [height - 1.5*inch, height - 2.5*inch, height - 3.5*inch, 
                   height - 4.5*inch, height - 5.5*inch, height - 6.5*inch]
    for y in y_positions:
        c.line(0.5*inch, y, width - 0.5*inch, y)
    
    # Vertical divider
    c.line(width/2, height - 1.5*inch, width/2, height - 6.5*inch)
    
    # Labels and values
    c.setFont("Helvetica", 8)
    
    # Box a - Employee's SSN
    c.drawString(0.6*inch, height - 1.35*inch, "a Employee's social security number")
    if not is_blank:
        c.setFont("Helvetica-Bold", 11)
        if low_quality:
            c.setFillColor(lightgrey)
        c.drawString(0.6*inch, height - 1.7*inch, employee_ssn)
        c.setFillColor(black)
    
    # Box b - Employer ID
    c.setFont("Helvetica", 8)
    c.drawString(0.6*inch, height - 2.35*inch, "b Employer identification number (EIN)")
    if not is_blank:
        c.setFont("Helvetica-Bold", 11)
        c.drawString(0.6*inch, height - 2.7*inch, ein)
    
    # Box c - Employer name and address
    c.setFont("Helvetica", 8)
    c.drawString(0.6*inch, height - 3.35*inch, "c Employer's name, address, and ZIP code")
    if not is_blank:
        c.setFont("Helvetica-Bold", 11)
        if low_quality:
            c.setFillColor(gray)
        c.drawString(0.6*inch, height - 3.7*inch, employer_name)
        c.setFillColor(black)
        c.setFont("Helvetica", 10)
        c.drawString(0.6*inch, height - 3.95*inch, "123 Business Ave")
        c.drawString(0.6*inch, height - 4.15*inch, "Anytown, ST 12345")
    
    # Box e - Employee name
    c.setFont("Helvetica", 8)
    c.drawString(0.6*inch, height - 4.85*inch, "e Employee's first name and initial    Last name")
    if not is_blank:
        c.setFont("Helvetica-Bold", 11)
        c.drawString(0.6*inch, height - 5.2*inch, employee_name)
    
    # Box f - Employee address
    c.setFont("Helvetica", 8)
    c.drawString(0.6*inch, height - 5.85*inch, "f Employee's address and ZIP code")
    if not is_blank:
        c.setFont("Helvetica", 10)
        c.drawString(0.6*inch, height - 6.2*inch, "456 Home Street, Hometown, ST 67890")
    
    # Right side - wage boxes
    # Box 1 - Wages
    c.setFont("Helvetica", 8)
    c.drawString(width/2 + 0.1*inch, height - 1.35*inch, "1 Wages, tips, other compensation")
    if not is_blank:
        c.setFont("Helvetica-Bold", 12)
        if low_quality:
            c.setFillColor(lightgrey)
        c.drawString(width/2 + 0.1*inch, height - 1.7*inch, f"${wages:,.2f}")
        c.setFillColor(black)
    
    # Box 2 - Federal tax withheld
    c.setFont("Helvetica", 8)
    c.drawString(width/2 + 0.1*inch, height - 2.35*inch, "2 Federal income tax withheld")
    if not is_blank:
        c.setFont("Helvetica-Bold", 12)
        fed_tax = wages * 0.22  # ~22% withholding
        c.drawString(width/2 + 0.1*inch, height - 2.7*inch, f"${fed_tax:,.2f}")
    
    # Box 3 - Social security wages
    c.setFont("Helvetica", 8)
    c.drawString(width/2 + 0.1*inch, height - 3.35*inch, "3 Social security wages")
    if not is_blank:
        c.setFont("Helvetica-Bold", 12)
        c.drawString(width/2 + 0.1*inch, height - 3.7*inch, f"${wages:,.2f}")
    
    # Box 4 - Social security tax withheld
    c.setFont("Helvetica", 8)
    c.drawString(width/2 + 0.1*inch, height - 4.35*inch, "4 Social security tax withheld")
    if not is_blank:
        c.setFont("Helvetica-Bold", 12)
        ss_tax = wages * 0.062  # 6.2%
        c.drawString(width/2 + 0.1*inch, height - 4.7*inch, f"${ss_tax:,.2f}")
    
    # Box 5 - Medicare wages
    c.setFont("Helvetica", 8)
    c.drawString(width/2 + 0.1*inch, height - 5.35*inch, "5 Medicare wages and tips")
    if not is_blank:
        c.setFont("Helvetica-Bold", 12)
        c.drawString(width/2 + 0.1*inch, height - 5.7*inch, f"${wages:,.2f}")
    
    # Box 6 - Medicare tax withheld
    c.setFont("Helvetica", 8)
    c.drawString(width/2 + 0.1*inch, height - 6.35*inch, "6 Medicare tax withheld")
    if not is_blank:
        c.setFont("Helvetica-Bold", 12)
        med_tax = wages * 0.0145  # 1.45%
        c.drawString(width/2 + 0.1*inch, height - 6.7*inch, f"${med_tax:,.2f}")
    
    # Footer
    c.setFont("Helvetica", 8)
    c.drawString(0.6*inch, 0.6*inch, f"Department of the Treasury - Internal Revenue Service")
    c.drawString(width - 2.5*inch, 0.6*inch, f"Form W-2 ({year})")


def draw_1099nec(c, payer_name, compensation, recipient_name="Jane D. Contractor",
                 recipient_tin="XXX-XX-5678", payer_tin="98-7654321", year="2024"):
    """Draw a 1099-NEC form."""
    width, height = letter
    
    # Title
    c.setFont("Helvetica-Bold", 16)
    c.drawString(1*inch, height - 0.75*inch, f"Form 1099-NEC Nonemployee Compensation {year}")
    
    # Form border
    c.setStrokeColor(black)
    c.setLineWidth(2)
    c.rect(0.5*inch, 2*inch, width - 1*inch, height - 2.5*inch)
    
    # Payer info box
    c.setLineWidth(1)
    c.rect(0.6*inch, height - 3*inch, 3.5*inch, 2*inch)
    
    c.setFont("Helvetica", 8)
    c.drawString(0.7*inch, height - 1.2*inch, "PAYER'S name, street address, city or town, state or province,")
    c.drawString(0.7*inch, height - 1.35*inch, "country, ZIP or foreign postal code, and telephone no.")
    
    c.setFont("Helvetica-Bold", 11)
    c.drawString(0.7*inch, height - 1.7*inch, payer_name)
    c.setFont("Helvetica", 10)
    c.drawString(0.7*inch, height - 1.95*inch, "789 Client Road")
    c.drawString(0.7*inch, height - 2.15*inch, "Business City, ST 11111")
    
    # Payer TIN
    c.setFont("Helvetica", 8)
    c.drawString(0.7*inch, height - 2.5*inch, "PAYER'S TIN")
    c.setFont("Helvetica-Bold", 11)
    c.drawString(0.7*inch, height - 2.8*inch, payer_tin)
    
    # Recipient info
    c.setFont("Helvetica", 8)
    c.drawString(0.6*inch, height - 3.5*inch, "RECIPIENT'S TIN")
    c.setFont("Helvetica-Bold", 11)
    c.drawString(0.6*inch, height - 3.8*inch, recipient_tin)
    
    c.setFont("Helvetica", 8)
    c.drawString(0.6*inch, height - 4.2*inch, "RECIPIENT'S name")
    c.setFont("Helvetica-Bold", 11)
    c.drawString(0.6*inch, height - 4.5*inch, recipient_name)
    
    c.setFont("Helvetica", 10)
    c.drawString(0.6*inch, height - 4.9*inch, "321 Freelance Lane")
    c.drawString(0.6*inch, height - 5.1*inch, "Worktown, ST 22222")
    
    # Box 1 - Nonemployee compensation (the main one)
    c.setLineWidth(1)
    c.rect(width/2 + 0.5*inch, height - 2.5*inch, 2.5*inch, 1.2*inch)
    
    c.setFont("Helvetica", 8)
    c.drawString(width/2 + 0.6*inch, height - 1.5*inch, "1 Nonemployee compensation")
    c.setFont("Helvetica-Bold", 14)
    c.drawString(width/2 + 0.6*inch, height - 2*inch, f"${compensation:,.2f}")
    
    # Box 4 - Federal tax withheld
    c.rect(width/2 + 0.5*inch, height - 4*inch, 2.5*inch, 1.2*inch)
    c.setFont("Helvetica", 8)
    c.drawString(width/2 + 0.6*inch, height - 3*inch, "4 Federal income tax withheld")
    c.setFont("Helvetica-Bold", 12)
    c.drawString(width/2 + 0.6*inch, height - 3.5*inch, "$0.00")
    
    # Footer
    c.setFont("Helvetica", 8)
    c.drawString(0.6*inch, 1.6*inch, f"Form 1099-NEC (Rev. 1-{year})")
    c.drawString(0.6*inch, 1.4*inch, "Department of the Treasury - Internal Revenue Service")


def draw_1099int(c, payer_name, interest, recipient_name="John Q. Taxpayer",
                 recipient_tin="XXX-XX-1234", payer_tin="11-2233445", year="2024"):
    """Draw a 1099-INT form."""
    width, height = letter
    
    # Title
    c.setFont("Helvetica-Bold", 16)
    c.drawString(1*inch, height - 0.75*inch, f"Form 1099-INT Interest Income {year}")
    
    # Form border
    c.setStrokeColor(black)
    c.setLineWidth(2)
    c.rect(0.5*inch, 2*inch, width - 1*inch, height - 2.5*inch)
    
    # Payer info
    c.setLineWidth(1)
    c.rect(0.6*inch, height - 3*inch, 3.5*inch, 2*inch)
    
    c.setFont("Helvetica", 8)
    c.drawString(0.7*inch, height - 1.2*inch, "PAYER'S name, street address, city, state, ZIP code")
    
    c.setFont("Helvetica-Bold", 11)
    c.drawString(0.7*inch, height - 1.6*inch, payer_name)
    c.setFont("Helvetica", 10)
    c.drawString(0.7*inch, height - 1.85*inch, "100 Finance Boulevard")
    c.drawString(0.7*inch, height - 2.05*inch, "Banking City, ST 33333")
    
    c.setFont("Helvetica", 8)
    c.drawString(0.7*inch, height - 2.5*inch, "PAYER'S TIN")
    c.setFont("Helvetica-Bold", 11)
    c.drawString(0.7*inch, height - 2.8*inch, payer_tin)
    
    # Recipient
    c.setFont("Helvetica", 8)
    c.drawString(0.6*inch, height - 3.5*inch, "RECIPIENT'S TIN")
    c.setFont("Helvetica-Bold", 11)
    c.drawString(0.6*inch, height - 3.8*inch, recipient_tin)
    
    c.setFont("Helvetica", 8)
    c.drawString(0.6*inch, height - 4.2*inch, "RECIPIENT'S name")
    c.setFont("Helvetica-Bold", 11)
    c.drawString(0.6*inch, height - 4.5*inch, recipient_name)
    
    # Box 1 - Interest income
    c.setLineWidth(1)
    c.rect(width/2 + 0.5*inch, height - 2.5*inch, 2.5*inch, 1.2*inch)
    
    c.setFont("Helvetica", 8)
    c.drawString(width/2 + 0.6*inch, height - 1.5*inch, "1 Interest income")
    c.setFont("Helvetica-Bold", 14)
    c.drawString(width/2 + 0.6*inch, height - 2*inch, f"${interest:,.2f}")
    
    # Box 2 - Early withdrawal penalty
    c.rect(width/2 + 0.5*inch, height - 4*inch, 2.5*inch, 1.2*inch)
    c.setFont("Helvetica", 8)
    c.drawString(width/2 + 0.6*inch, height - 3*inch, "2 Early withdrawal penalty")
    c.setFont("Helvetica-Bold", 12)
    c.drawString(width/2 + 0.6*inch, height - 3.5*inch, "$0.00")
    
    # Footer
    c.setFont("Helvetica", 8)
    c.drawString(0.6*inch, 1.6*inch, f"Form 1099-INT ({year})")
    c.drawString(0.6*inch, 1.4*inch, "Department of the Treasury - Internal Revenue Service")


def draw_1099div(c, payer_name, dividends, recipient_name="John Q. Taxpayer",
                 recipient_tin="XXX-XX-1234", payer_tin="55-6677889", year="2024"):
    """Draw a 1099-DIV form."""
    width, height = letter
    
    # Title
    c.setFont("Helvetica-Bold", 16)
    c.drawString(1*inch, height - 0.75*inch, f"Form 1099-DIV Dividends and Distributions {year}")
    
    # Form border
    c.setStrokeColor(black)
    c.setLineWidth(2)
    c.rect(0.5*inch, 2*inch, width - 1*inch, height - 2.5*inch)
    
    # Payer info
    c.setLineWidth(1)
    c.rect(0.6*inch, height - 3*inch, 3.5*inch, 2*inch)
    
    c.setFont("Helvetica", 8)
    c.drawString(0.7*inch, height - 1.2*inch, "PAYER'S name, street address, city, state, ZIP code")
    
    c.setFont("Helvetica-Bold", 11)
    c.drawString(0.7*inch, height - 1.6*inch, payer_name)
    c.setFont("Helvetica", 10)
    c.drawString(0.7*inch, height - 1.85*inch, "500 Investment Plaza")
    c.drawString(0.7*inch, height - 2.05*inch, "Wall Street, NY 10001")
    
    c.setFont("Helvetica", 8)
    c.drawString(0.7*inch, height - 2.5*inch, "PAYER'S TIN")
    c.setFont("Helvetica-Bold", 11)
    c.drawString(0.7*inch, height - 2.8*inch, payer_tin)
    
    # Recipient
    c.setFont("Helvetica", 8)
    c.drawString(0.6*inch, height - 3.5*inch, "RECIPIENT'S TIN")
    c.setFont("Helvetica-Bold", 11)
    c.drawString(0.6*inch, height - 3.8*inch, recipient_tin)
    
    c.setFont("Helvetica", 8)
    c.drawString(0.6*inch, height - 4.2*inch, "RECIPIENT'S name")
    c.setFont("Helvetica-Bold", 11)
    c.drawString(0.6*inch, height - 4.5*inch, recipient_name)
    
    # Box 1a - Total ordinary dividends
    c.setLineWidth(1)
    c.rect(width/2 + 0.5*inch, height - 2.5*inch, 2.5*inch, 1.2*inch)
    
    c.setFont("Helvetica", 8)
    c.drawString(width/2 + 0.6*inch, height - 1.5*inch, "1a Total ordinary dividends")
    c.setFont("Helvetica-Bold", 14)
    c.drawString(width/2 + 0.6*inch, height - 2*inch, f"${dividends:,.2f}")
    
    # Box 1b - Qualified dividends
    c.rect(width/2 + 0.5*inch, height - 4*inch, 2.5*inch, 1.2*inch)
    c.setFont("Helvetica", 8)
    c.drawString(width/2 + 0.6*inch, height - 3*inch, "1b Qualified dividends")
    c.setFont("Helvetica-Bold", 12)
    qualified = dividends * 0.8  # Assume 80% qualified
    c.drawString(width/2 + 0.6*inch, height - 3.5*inch, f"${qualified:,.2f}")
    
    # Footer
    c.setFont("Helvetica", 8)
    c.drawString(0.6*inch, 1.6*inch, f"Form 1099-DIV ({year})")
    c.drawString(0.6*inch, 1.4*inch, "Department of the Treasury - Internal Revenue Service")


def draw_1098(c, lender_name, interest, borrower_name="John Q. Taxpayer",
              borrower_tin="XXX-XX-1234", lender_tin="77-8899001", year="2024"):
    """Draw a 1098 Mortgage Interest Statement."""
    width, height = letter
    
    # Title
    c.setFont("Helvetica-Bold", 16)
    c.drawString(1*inch, height - 0.75*inch, f"Form 1098 Mortgage Interest Statement {year}")
    
    # Form border
    c.setStrokeColor(black)
    c.setLineWidth(2)
    c.rect(0.5*inch, 2*inch, width - 1*inch, height - 2.5*inch)
    
    # Lender info
    c.setLineWidth(1)
    c.rect(0.6*inch, height - 3*inch, 3.5*inch, 2*inch)
    
    c.setFont("Helvetica", 8)
    c.drawString(0.7*inch, height - 1.2*inch, "RECIPIENT'S/LENDER'S name, address, and telephone number")
    
    c.setFont("Helvetica-Bold", 11)
    c.drawString(0.7*inch, height - 1.6*inch, lender_name)
    c.setFont("Helvetica", 10)
    c.drawString(0.7*inch, height - 1.85*inch, "200 Mortgage Way")
    c.drawString(0.7*inch, height - 2.05*inch, "Lending City, ST 44444")
    
    c.setFont("Helvetica", 8)
    c.drawString(0.7*inch, height - 2.5*inch, "RECIPIENT'S TIN")
    c.setFont("Helvetica-Bold", 11)
    c.drawString(0.7*inch, height - 2.8*inch, lender_tin)
    
    # Borrower (Payer)
    c.setFont("Helvetica", 8)
    c.drawString(0.6*inch, height - 3.5*inch, "PAYER'S/BORROWER'S TIN")
    c.setFont("Helvetica-Bold", 11)
    c.drawString(0.6*inch, height - 3.8*inch, borrower_tin)
    
    c.setFont("Helvetica", 8)
    c.drawString(0.6*inch, height - 4.2*inch, "PAYER'S/BORROWER'S name")
    c.setFont("Helvetica-Bold", 11)
    c.drawString(0.6*inch, height - 4.5*inch, borrower_name)
    
    c.setFont("Helvetica", 10)
    c.drawString(0.6*inch, height - 4.9*inch, "456 Home Street")
    c.drawString(0.6*inch, height - 5.1*inch, "Hometown, ST 67890")
    
    # Box 1 - Mortgage interest received
    c.setLineWidth(1)
    c.rect(width/2 + 0.5*inch, height - 2.5*inch, 2.5*inch, 1.2*inch)
    
    c.setFont("Helvetica", 8)
    c.drawString(width/2 + 0.6*inch, height - 1.5*inch, "1 Mortgage interest received from payer(s)/borrower(s)")
    c.setFont("Helvetica-Bold", 14)
    c.drawString(width/2 + 0.6*inch, height - 2*inch, f"${interest:,.2f}")
    
    # Box 2 - Outstanding mortgage principal
    c.rect(width/2 + 0.5*inch, height - 4*inch, 2.5*inch, 1.2*inch)
    c.setFont("Helvetica", 8)
    c.drawString(width/2 + 0.6*inch, height - 3*inch, "2 Outstanding mortgage principal")
    c.setFont("Helvetica-Bold", 12)
    principal = interest * 25  # Rough estimate
    c.drawString(width/2 + 0.6*inch, height - 3.5*inch, f"${principal:,.2f}")
    
    # Footer
    c.setFont("Helvetica", 8)
    c.drawString(0.6*inch, 1.6*inch, f"Form 1098 ({year})")
    c.drawString(0.6*inch, 1.4*inch, "Department of the Treasury - Internal Revenue Service")


def main():
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    
    documents = []
    
    # 1. W-2 Acme Corp
    filename = "w2-acme-2024.pdf"
    c = canvas.Canvas(f"{OUTPUT_DIR}/{filename}", pagesize=letter)
    draw_w2(c, "Acme Corp", 75432.00)
    c.save()
    print(f"✓ Created {filename}")
    documents.append({
        "filename": filename,
        "type": "W-2",
        "employer": "Acme Corp",
        "wages": 75432.00
    })
    
    # 2. W-2 TechStart Inc
    filename = "w2-techstart-2024.pdf"
    c = canvas.Canvas(f"{OUTPUT_DIR}/{filename}", pagesize=letter)
    draw_w2(c, "TechStart Inc", 92150.00)
    c.save()
    print(f"✓ Created {filename}")
    documents.append({
        "filename": filename,
        "type": "W-2",
        "employer": "TechStart Inc",
        "wages": 92150.00
    })
    
    # 3. W-2 GlobalCo LLC
    filename = "w2-globalco-2024.pdf"
    c = canvas.Canvas(f"{OUTPUT_DIR}/{filename}", pagesize=letter)
    draw_w2(c, "GlobalCo LLC", 55000.00)
    c.save()
    print(f"✓ Created {filename}")
    documents.append({
        "filename": filename,
        "type": "W-2",
        "employer": "GlobalCo LLC",
        "wages": 55000.00
    })
    
    # 4. 1099-NEC Consulting Partners
    filename = "1099nec-consult-2024.pdf"
    c = canvas.Canvas(f"{OUTPUT_DIR}/{filename}", pagesize=letter)
    draw_1099nec(c, "Consulting Partners", 45000.00)
    c.save()
    print(f"✓ Created {filename}")
    documents.append({
        "filename": filename,
        "type": "1099-NEC",
        "payer": "Consulting Partners",
        "compensation": 45000.00
    })
    
    # 5. 1099-NEC Freelance Hub
    filename = "1099nec-freelance-2024.pdf"
    c = canvas.Canvas(f"{OUTPUT_DIR}/{filename}", pagesize=letter)
    draw_1099nec(c, "Freelance Hub", 28500.00)
    c.save()
    print(f"✓ Created {filename}")
    documents.append({
        "filename": filename,
        "type": "1099-NEC",
        "payer": "Freelance Hub",
        "compensation": 28500.00
    })
    
    # 6. 1099-INT Big Bank
    filename = "1099int-bigbank-2024.pdf"
    c = canvas.Canvas(f"{OUTPUT_DIR}/{filename}", pagesize=letter)
    draw_1099int(c, "Big Bank", 1234.00)
    c.save()
    print(f"✓ Created {filename}")
    documents.append({
        "filename": filename,
        "type": "1099-INT",
        "payer": "Big Bank",
        "interest": 1234.00
    })
    
    # 7. 1099-DIV Investment Corp
    filename = "1099div-invest-2024.pdf"
    c = canvas.Canvas(f"{OUTPUT_DIR}/{filename}", pagesize=letter)
    draw_1099div(c, "Investment Corp", 5678.00)
    c.save()
    print(f"✓ Created {filename}")
    documents.append({
        "filename": filename,
        "type": "1099-DIV",
        "payer": "Investment Corp",
        "dividends": 5678.00
    })
    
    # 8. 1098 Home Loans Inc
    filename = "1098-mortgage-2024.pdf"
    c = canvas.Canvas(f"{OUTPUT_DIR}/{filename}", pagesize=letter)
    draw_1098(c, "Home Loans Inc", 12345.00)
    c.save()
    print(f"✓ Created {filename}")
    documents.append({
        "filename": filename,
        "type": "1098",
        "lender": "Home Loans Inc",
        "interest": 12345.00
    })
    
    # 9. Blank W-2 template (edge case)
    filename = "w2-blank-template.pdf"
    c = canvas.Canvas(f"{OUTPUT_DIR}/{filename}", pagesize=letter)
    draw_w2(c, "", 0, is_blank=True)
    c.save()
    print(f"✓ Created {filename}")
    documents.append({
        "filename": filename,
        "type": "W-2",
        "isBlank": True
    })
    
    # 10. Low quality W-2 (edge case)
    filename = "w2-lowquality-2024.pdf"
    c = canvas.Canvas(f"{OUTPUT_DIR}/{filename}", pagesize=letter)
    draw_w2(c, "Faded Corp", 48750.00, low_quality=True)
    c.save()
    print(f"✓ Created {filename}")
    documents.append({
        "filename": filename,
        "type": "W-2",
        "employer": "Faded Corp",
        "wages": 48750.00,
        "isLowQuality": True
    })
    
    print(f"\n✅ Generated {len(documents)} tax documents in {OUTPUT_DIR}/")
    return documents


if __name__ == "__main__":
    main()
