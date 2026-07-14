-- DropIndex
DROP INDEX "StaffMember_squareTeamMemberId_key";

-- CreateIndex
CREATE UNIQUE INDEX "StaffMember_organizationId_squareTeamMemberId_key" ON "StaffMember"("organizationId", "squareTeamMemberId");
