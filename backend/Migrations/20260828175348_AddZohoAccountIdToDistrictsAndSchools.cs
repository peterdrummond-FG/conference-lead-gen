using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ConferenceLeadGen.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddZohoAccountIdToDistrictsAndSchools : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "zoho_account_id",
                table: "schools",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "zoho_account_id",
                table: "school_districts",
                type: "text",
                nullable: true);

            migrationBuilder.CreateIndex(
                name: "ix_schools_zoho_account_id",
                table: "schools",
                column: "zoho_account_id",
                unique: true,
                filter: "zoho_account_id IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "ix_school_districts_zoho_account_id",
                table: "school_districts",
                column: "zoho_account_id",
                unique: true,
                filter: "zoho_account_id IS NOT NULL");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "ix_schools_zoho_account_id",
                table: "schools");

            migrationBuilder.DropIndex(
                name: "ix_school_districts_zoho_account_id",
                table: "school_districts");

            migrationBuilder.DropColumn(
                name: "zoho_account_id",
                table: "schools");

            migrationBuilder.DropColumn(
                name: "zoho_account_id",
                table: "school_districts");
        }
    }
}
