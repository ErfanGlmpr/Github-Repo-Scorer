import { ApiProperty } from '@nestjs/swagger';

/**
 * Shape of each repository in the API response.
 * Used for Swagger documentation only — the actual data
 * comes from the ScoredRepository interface.
 */
export class RepositoryResponseDto {
  @ApiProperty({ example: 'vscode' })
  name!: string;

  @ApiProperty({ example: 'microsoft/vscode' })
  fullName!: string;

  @ApiProperty({ example: 'https://github.com/microsoft/vscode' })
  url!: string;

  @ApiProperty({ example: 150000 })
  stars!: number;

  @ApiProperty({ example: 28000 })
  forks!: number;

  @ApiProperty({ example: '2024-12-01T10:00:00Z' })
  updatedAt!: string;

  @ApiProperty({
    example: 6.1234,
    description: 'Computed popularity score based on stars, forks, and recency',
  })
  score!: number;
}
