# Office Monitor - Security and Functional Review Report

**Date:** January 29, 2026  
**Project:** Office Infrastructure Monitor  
**Scope:** Single-office IT department dashboard  
**Reviewer:** Security and Functional Analysis

---

## Executive Summary

This report provides a comprehensive review of the Office Monitor application from both security and functional perspectives. The application is designed for monitoring office infrastructure (network devices, printers, Zoom Rooms) for a single office's IT department.

**Overall Assessment:**
- **Security Status:** ⚠️ **Moderate Risk** - Several security vulnerabilities identified that should be addressed
- **Functional Status:** ✅ **Good** - Core functionality is solid with some areas for improvement

**Key Findings:**
- 12 security vulnerabilities identified (3 Critical, 5 High, 4 Medium)
- 8 functional issues identified
- Good use of prepared statements (SQL injection protection)
- Password hashing implemented correctly
- Authentication system in place but needs strengthening

---

## Security Issues

### 🔴 CRITICAL SEVERITY

#### 1. Default Admin Credentials
**What it means:** The application creates a default administrator account with predictable username and password that anyone can guess.

**Technical Details:**
- Default username: `admin`
- Default password: `changeme123` (or `admin123` if not set)
- These credentials are documented in the README and code

**Impact:**
- Anyone who knows about the application can log in as administrator
- Full access to all monitoring data, ability to modify configurations, delete devices, and manage users
- Complete system compromise

**How to Fix:**
1. **Immediate:** Force password change on first login for default admin account
2. **Short-term:** Remove default credentials from code and README
3. **Long-term:** Require admin account creation during initial setup wizard
4. Add a check that prevents the application from starting if default credentials are still in use after first login

**Why this approach:**
- Forces immediate security improvement while maintaining usability
- Setup wizard ensures proper configuration before first use
- Prevents accidental deployment with default credentials

---

#### 2. Unauthenticated Floor Plan Upload Endpoint
**What it means:** The endpoint that allows uploading floor plan images does not require users to log in first.

**Technical Details:**
- Endpoint: `PUT /api/floor-plans/:floor`
- No authentication middleware applied
- Anyone can upload images to the server

**Impact:**
- Unauthorized users can upload malicious files or fill up storage
- Potential for denial of service (storage exhaustion)
- No audit trail of who uploaded what

**How to Fix:**
1. Add `authMiddleware` to the floor plan upload endpoint
2. Add file size limits (e.g., maximum 5MB per image)
3. Validate file types (only allow image formats: PNG, JPEG, GIF, WebP)
4. Scan uploaded images for malicious content if possible
5. Add logging of who uploaded which floor plan

**Why this approach:**
- Ensures only authorized IT staff can modify floor plans
- Prevents storage abuse
- Maintains accountability through logging

---

#### 3. Hardcoded Default Password Reset
**What it means:** When users request a password reset, the system sets their password to a fixed, known value: `ob123456`.

**Technical Details:**
- Located in `/api/auth/forgot-password` endpoint
- Password reset always sets password to `ob123456`
- This password is visible in the code

**Impact:**
- Anyone who knows a username can reset that user's password to a known value
- No verification that the person requesting reset is actually the account owner
- Temporary password is weak and predictable

**How to Fix:**
1. Generate a random, secure temporary password for each reset (minimum 12 characters, mix of letters, numbers, symbols)
2. Send the temporary password securely (e.g., via encrypted email or secure Slack message)
3. Require password change on next login (already implemented)
4. Add rate limiting to password reset endpoint (prevent abuse)
5. Consider implementing password reset tokens that expire after 1 hour

**Why this approach:**
- Random passwords prevent guessing
- Secure delivery ensures only legitimate users receive the password
- Rate limiting prevents automated attacks
- Expiring tokens add time-based security

---

### 🟠 HIGH SEVERITY

#### 4. WebSocket Connections Not Authenticated
**What it means:** The WebSocket server accepts connections from anyone without checking if they're logged in.

**Technical Details:**
- WebSocket server accepts all connections
- No authentication check on connection
- All connected clients receive real-time updates about device status

**Impact:**
- Unauthorized users can connect and receive real-time monitoring data
- Potential for information disclosure
- No way to track who is connected

**How to Fix:**
1. Require authentication token in WebSocket connection URL or initial handshake
2. Verify token before accepting connection
3. Associate each WebSocket connection with a user account
4. Log WebSocket connections and disconnections
5. Optionally: restrict certain data based on user role

**Why this approach:**
- Maintains real-time functionality while securing access
- Allows role-based data filtering if needed
- Provides audit trail

---

#### 5. HTTPS Certificate Validation Disabled
**What it means:** The application is configured to ignore SSL/TLS certificate errors when connecting to external services.

**Technical Details:**
- Code contains: `rejectUnauthorized: false` in HTTPS agent
- This disables certificate validation for HTTPS connections

**Impact:**
- Vulnerable to man-in-the-middle attacks
- Cannot detect if external API connections are being intercepted
- Compromises security of connections to Poly Lens and Zoom APIs

**How to Fix:**
1. Remove `rejectUnauthorized: false` setting
2. Ensure all external APIs use valid SSL certificates
3. If self-signed certificates are necessary (development only), make this configurable via environment variable
4. Add warning logs when certificate validation fails
5. For production, always require valid certificates

**Why this approach:**
- Protects against interception attacks
- Maintains security of API communications
- Allows development flexibility when needed

---

#### 6. Weak Password Requirements
**What it means:** The system only requires passwords to be 6 characters long, which is too short for security.

**Technical Details:**
- Minimum password length: 6 characters
- No complexity requirements (uppercase, lowercase, numbers, symbols)
- No password history to prevent reuse

**Impact:**
- Easy to guess or brute-force passwords
- Users likely to choose simple passwords
- Increased risk of account compromise

**How to Fix:**
1. Increase minimum password length to 12 characters
2. Require password complexity:
   - At least one uppercase letter
   - At least one lowercase letter
   - At least one number
   - At least one special character
3. Implement password strength meter in UI
4. Consider password history (prevent reusing last 5 passwords)
5. Add password expiration policy (e.g., change every 90 days)

**Why this approach:**
- Significantly increases password security
- Industry-standard requirements
- Balance between security and usability

---

#### 7. Password Reset Without Identity Verification
**What it means:** Users can reset their password by just providing their username - no proof that they own the account.

**Technical Details:**
- `/api/auth/forgot-password` endpoint only requires username
- No email verification, security questions, or other verification
- Anyone can reset anyone else's password if they know the username

**Impact:**
- Account takeover vulnerability
- Malicious users can lock out legitimate users
- No way to verify legitimate password reset requests

**How to Fix:**
1. Implement email verification (send reset link to registered email)
2. Or use Slack notification with approval workflow (if email not available)
3. Generate secure, time-limited reset tokens (expire after 1 hour)
4. Log all password reset attempts
5. Rate limit password reset requests per username/IP address

**Why this approach:**
- Verifies account ownership before allowing password change
- Time-limited tokens reduce attack window
- Rate limiting prevents abuse

---

#### 8. CORS Allows Requests with No Origin
**What it means:** The application accepts requests from applications that don't send an "origin" header, which includes mobile apps, curl commands, and some automated tools.

**Technical Details:**
- Code: `if (!origin) return callback(null, true);`
- This allows requests from tools that don't send origin headers

**Impact:**
- Potential for cross-origin attacks from tools that don't send origin
- Less strict than necessary for web application
- Could allow unauthorized API access

**How to Fix:**
1. Remove the "no origin" exception for web browsers
2. Only allow requests with valid origin headers
3. Maintain exception only for specific use cases (e.g., mobile app with API key)
4. Log blocked CORS requests for monitoring
5. Consider using API keys for programmatic access instead

**Why this approach:**
- Tighter security for web interface
- Maintains flexibility for legitimate programmatic access
- Better audit trail

---

### 🟡 MEDIUM SEVERITY

#### 9. No Account Lockout After Failed Login Attempts
**What it means:** While there is rate limiting, individual accounts are not locked after multiple failed login attempts.

**Technical Details:**
- Rate limiting is based on IP address, not username
- Same account can be attacked from multiple IPs
- No account-level lockout mechanism

**Impact:**
- Brute force attacks can continue from different IP addresses
- Legitimate users not protected if their password is being guessed
- No notification to account owner of suspicious activity

**How to Fix:**
1. Track failed login attempts per username
2. Lock account after 5 failed attempts for 30 minutes
3. Send notification (Slack/email) when account is locked
4. Allow admin to unlock accounts manually
5. Log all failed login attempts with IP address

**Why this approach:**
- Protects individual accounts from brute force
- Alerts users to potential compromise attempts
- Balances security with usability

---

#### 10. Insufficient File Upload Validation
**What it means:** Floor plan uploads have minimal validation - only checks that data exists, not file size, type, or content.

**Technical Details:**
- Only checks: `if (!image_data || !image_type)`
- No file size limit enforcement
- No validation that image_data is actually a valid image
- No content-type verification

**Impact:**
- Potential for storage exhaustion (upload huge files)
- Could upload non-image files disguised as images
- Database bloat from large base64-encoded images

**How to Fix:**
1. Enforce maximum file size (e.g., 5MB)
2. Validate file type matches declared image_type
3. Verify image_data is valid base64
4. Optionally: decode and validate image is actually a valid image file
5. Store images in file system instead of database (better performance)
6. Compress images before storage

**Why this approach:**
- Prevents storage abuse
- Ensures data integrity
- Better performance with file-based storage

---

#### 11. Session Tokens Never Expire or Rotate
**What it means:** Once a user logs in, their session token is valid for 24 hours and doesn't change. If stolen, it works until expiration.

**Technical Details:**
- Tokens expire after 24 hours
- Same token used for entire session
- No token rotation on activity
- Tokens stored in database but no forced logout capability

**Impact:**
- Stolen tokens remain valid for full 24 hours
- No way to invalidate stolen tokens (except waiting)
- No detection of token reuse from different locations

**How to Fix:**
1. Implement token rotation (issue new token periodically)
2. Add "logout all devices" functionality
3. Track token usage (IP address, user agent)
4. Alert on suspicious token usage (different IP/location)
5. Implement shorter default session (e.g., 8 hours) with "remember me" option
6. Add ability for admins to force logout specific users

**Why this approach:**
- Limits damage from stolen tokens
- Provides control over active sessions
- Better security monitoring

---

#### 12. Sensitive Information in Logs
**What it means:** The application logs various information that could include sensitive data or help attackers.

**Technical Details:**
- Console logs include user actions, errors, and system state
- Error messages might reveal system internals
- No distinction between debug and production logging levels

**Impact:**
- Logs might contain passwords, tokens, or other sensitive data
- Error messages could reveal system structure to attackers
- No log rotation or secure storage

**How to Fix:**
1. Implement log levels (debug, info, warn, error)
2. Never log passwords, tokens, or API keys
3. Sanitize error messages before logging (remove stack traces in production)
4. Implement log rotation (prevent disk fill)
5. Store logs securely (restricted file permissions)
6. Consider structured logging (JSON format) for better parsing

**Why this approach:**
- Prevents information leakage
- Maintains useful debugging while protecting sensitive data
- Better log management

---

## Functional Issues

### 1. No Environment Variable Validation on Startup
**Issue:** The application doesn't verify that required environment variables are set before starting.

**Impact:**
- Application may start in broken state
- Missing configuration only discovered when features are used
- Poor user experience

**Recommendation:**
- Validate all required environment variables on startup
- Fail fast with clear error messages if critical variables missing
- Provide default values only for truly optional settings

---

### 2. No Database Backup Strategy
**Issue:** While database cleanup is implemented, there's no backup mechanism mentioned.

**Impact:**
- Data loss risk if database file is corrupted or deleted
- No recovery option from accidental deletions
- Potential loss of monitoring history

**Recommendation:**
- Implement automated daily backups
- Store backups in separate location
- Test backup restoration process
- Consider versioning for critical data

---

### 3. No Audit Trail for Sensitive Operations
**Issue:** While some operations are logged, there's no comprehensive audit trail for security-sensitive actions.

**Impact:**
- Cannot track who made what changes
- Difficult to investigate security incidents
- No compliance trail

**Recommendation:**
- Log all user management operations (create, update, delete users)
- Log all configuration changes (monitors, integrations)
- Log all authentication events (login, logout, failed attempts)
- Store audit logs separately from application logs
- Implement log retention policy

---

### 4. Limited Error Handling in Some Areas
**Issue:** Some API endpoints don't have comprehensive error handling, potentially exposing internal errors.

**Impact:**
- Poor user experience when errors occur
- Potential information leakage through error messages
- Application crashes possible

**Recommendation:**
- Implement global error handler middleware
- Return generic error messages to users
- Log detailed errors server-side only
- Add try-catch blocks around all database operations

---

### 5. No Health Check Endpoint for Monitoring
**Issue:** While there's a health endpoint, it may not be comprehensive enough for external monitoring tools.

**Impact:**
- Difficult to monitor application health externally
- No way to detect if application is in degraded state
- Limited observability

**Recommendation:**
- Enhance health endpoint with:
  - Database connectivity check
  - External API connectivity (Poly Lens, Zoom)
  - Disk space check
  - Memory usage
- Return appropriate HTTP status codes
- Add metrics endpoint for monitoring tools

---

### 6. Rate Limiting Only on Login
**Issue:** Rate limiting is only implemented for login endpoint, not for other sensitive operations.

**Impact:**
- Other endpoints vulnerable to abuse
- No protection against automated attacks on other endpoints
- Potential for denial of service

**Recommendation:**
- Implement rate limiting for:
  - Password reset endpoint
  - User creation endpoint
  - API integration updates
  - Floor plan uploads
- Use different limits for different endpoints
- Consider using a library like `express-rate-limit`

---

### 7. No Input Sanitization for All User Inputs
**Issue:** While some inputs are validated, not all user-provided data is sanitized before storage or display.

**Impact:**
- Potential for stored XSS (cross-site scripting)
- Database pollution with malicious data
- Display issues with special characters

**Recommendation:**
- Sanitize all user inputs before database storage
- Use parameterized queries (already done - good!)
- Escape output when displaying user data
- Validate data types and formats strictly
- Consider using a library like `validator.js` or `sanitize-html`

---

### 8. Database File Permissions Not Set
**Issue:** No code to ensure database file has restrictive permissions.

**Impact:**
- Database file might be readable by other users on system
- Potential unauthorized access to monitoring data
- Security risk if server is compromised

**Recommendation:**
- Set database file permissions to 600 (read/write owner only) on creation
- Ensure database directory has proper permissions
- Document file permission requirements
- Add check on startup to verify permissions

---

## Positive Security Practices Found

✅ **Good Practices Already Implemented:**
1. **SQL Injection Protection:** Uses prepared statements throughout (excellent!)
2. **Password Hashing:** Uses bcrypt with proper salt rounds
3. **Authentication Middleware:** Properly implemented for most endpoints
4. **Security Headers:** X-Content-Type-Options, X-Frame-Options, X-XSS-Protection set
5. **Rate Limiting:** Implemented for login endpoint
6. **Session Management:** Tokens stored securely, expiration implemented
7. **Input Validation:** Many endpoints validate input types and formats
8. **CORS Configuration:** Attempts to restrict origins (needs improvement)
9. **2FA Support:** TOTP and Slack 2FA options available
10. **Pending Changes System:** Approval workflow for sensitive changes

---

## Recommendations Priority

### Immediate (Fix Before Production)
1. ✅ Change default admin credentials
2. ✅ Add authentication to floor plan upload endpoint
3. ✅ Fix hardcoded password reset
4. ✅ Authenticate WebSocket connections
5. ✅ Enable HTTPS certificate validation

### Short-term (Within 1 Month)
6. ✅ Strengthen password requirements
7. ✅ Implement proper password reset verification
8. ✅ Add account lockout mechanism
9. ✅ Improve file upload validation
10. ✅ Implement token rotation

### Medium-term (Within 3 Months)
11. ✅ Fix CORS configuration
12. ✅ Improve logging and remove sensitive data
13. ✅ Add comprehensive audit trail
14. ✅ Implement database backups
15. ✅ Add rate limiting to more endpoints

### Long-term (Ongoing)
16. ✅ Regular security audits
17. ✅ Dependency updates and vulnerability scanning
18. ✅ Security training for IT staff
19. ✅ Incident response plan
20. ✅ Regular penetration testing

---

## Conclusion

The Office Monitor application demonstrates good security practices in several areas, particularly SQL injection prevention and password hashing. However, there are critical vulnerabilities that must be addressed before production deployment, especially around default credentials, authentication gaps, and password reset functionality.

The functional issues are generally minor and relate to operational concerns like backups, logging, and error handling. These should be addressed to improve reliability and maintainability.

**Overall Recommendation:** Address all Critical and High severity issues before production use. The application is functional but needs security hardening for a production environment.

---

## Appendix: Testing Recommendations

To verify fixes are working:

1. **Default Credentials Test:**
   - Verify default admin account requires password change on first login
   - Verify application won't start with default credentials after first use

2. **Authentication Tests:**
   - Attempt to access protected endpoints without token (should fail)
   - Attempt to upload floor plan without authentication (should fail)
   - Attempt WebSocket connection without token (should fail)

3. **Password Reset Test:**
   - Request password reset and verify random password generated
   - Verify reset token expires after 1 hour
   - Verify rate limiting prevents abuse

4. **File Upload Test:**
   - Attempt to upload file larger than 5MB (should fail)
   - Attempt to upload non-image file (should fail)
   - Verify only authenticated users can upload

5. **Rate Limiting Test:**
   - Attempt multiple rapid login attempts (should be blocked)
   - Verify account lockout after 5 failed attempts

---

**Report End**
