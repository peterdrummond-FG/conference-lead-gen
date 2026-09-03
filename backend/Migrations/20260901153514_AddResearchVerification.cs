using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ConferenceLeadGen.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddResearchVerification : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<bool>(
                name: "person_verified",
                table: "contacts",
                type: "boolean",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "research_confidence",
                table: "contacts",
                type: "text",
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "person_verified",
                table: "contacts");

            migrationBuilder.DropColumn(
                name: "research_confidence",
                table: "contacts");
        }
    }
}
